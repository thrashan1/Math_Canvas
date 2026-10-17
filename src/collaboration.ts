import * as Y from 'yjs'
import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  getDatabase,
  get,
  onChildAdded,
  onChildRemoved,
  onValue,
  onDisconnect,
  push,
  ref,
  remove,
  runTransaction,
  set,
  update,
  type Database,
  type DataSnapshot,
  type Unsubscribe,
} from 'firebase/database'
import type { CanvasItem, CanvasRect, Point, RemoteCursor } from './canvas'
import { firebaseClientConfig } from './firebase-client-config'

export type CollaborationPeer = { peerId: string; name: string }
export type CollaborationRoom = { code: string; name: string }

export function isFirebaseConfigured() {
  const env = import.meta.env
  return Boolean(env.VITE_FIREBASE_API_KEY || firebaseClientConfig.apiKey)
}

type CollaborationEvent = {
  type: string
  peerId?: string
  name?: string
  approved?: boolean
  from?: string
  payload?: { type: 'description'; description: RTCSessionDescriptionInit } | { type: 'candidate'; candidate: RTCIceCandidateInit }
}

type PeerConnection = {
  connection: RTCPeerConnection
  channel?: RTCDataChannel
  parts: Map<number, { total: number; chunks: Uint8Array[]; received: number }>
  queue: Uint8Array[]
  pendingCandidates: RTCIceCandidateInit[]
  initialSyncPending?: boolean
}

type SessionCallbacks = {
  initialItems: CanvasItem[]
  onItems: (items: CanvasItem[]) => void
  onPeers: (peers: CollaborationPeer[]) => void
  onCursors: (cursors: RemoteCursor[]) => void
  onJoinRequest: (peer: CollaborationPeer) => void
  onJoinRequestRemoved: (peerId: string) => void
  onStatus: (message: string) => void
}

const FIREBASE_REQUEST_TIMEOUT_MS = 15_000
const CHUNK_SIZE = 12 * 1024
const CHUNK_HEADER_SIZE = 12
const MAX_TRANSFER_BYTES = 128 * 1024 * 1024
const MAX_PENDING_TRANSFERS = 4
const MAX_PENDING_SIGNALS_PER_PEER = 64
const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
const CURSOR_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#7c3aed', '#ea580c', '#0891b2']
const PRESENCE_THROTTLE_MS = 50

function firebaseConfig() {
  const env = import.meta.env
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY || firebaseClientConfig.apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || firebaseClientConfig.authDomain,
    databaseURL: env.VITE_FIREBASE_DATABASE_URL || firebaseClientConfig.databaseURL,
    projectId: env.VITE_FIREBASE_PROJECT_ID || firebaseClientConfig.projectId,
    appId: env.VITE_FIREBASE_APP_ID || firebaseClientConfig.appId,
  }
  if (Object.values(config).some((value) => !value)) {
    throw new Error('Firebase is not configured. Add the public Firebase web app configuration or set the VITE_FIREBASE_* values and restart MathCanvas.')
  }
  return config
}

async function getFirebaseServices() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig())
  const auth = getAuth(app)
  if (!auth.currentUser) {
    try {
      await withTimeout(
        signInAnonymously(auth),
        'Firebase sign-in timed out. Check your internet connection, API key/project settings, and that Anonymous sign-in is enabled.',
      )
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) throw error
      throw new Error(`Firebase anonymous sign-in failed: ${error instanceof Error ? error.message : String(error)}. Check Authentication → Sign-in method and enable Anonymous.`)
    }
  }
  if (!auth.currentUser) throw new Error('Firebase anonymous sign-in did not return a user.')
  return { auth, database: getDatabase(app), uid: auth.currentUser.uid }
}

function createRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('')
}

function roomPath(code: string, suffix = '') {
  return `rooms/${code}${suffix ? `/${suffix}` : ''}`
}

function withTimeout<T>(promise: Promise<T>, timeoutMessage: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(timeoutMessage)), FIREBASE_REQUEST_TIMEOUT_MS)
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

function serializeDescription(description: RTCSessionDescription | null): RTCSessionDescriptionInit {
  if (!description?.sdp) throw new Error('WebRTC did not produce a session description.')
  return { type: description.type, sdp: description.sdp }
}

function parseDescription(value: unknown): RTCSessionDescriptionInit {
  if (!value || typeof value !== 'object') throw new Error('The peer sent an invalid WebRTC session description.')
  const description = value as { type?: unknown; sdp?: unknown }
  if ((description.type !== 'offer' && description.type !== 'answer') || typeof description.sdp !== 'string' || !description.sdp.trim()) {
    throw new Error('The peer sent an incomplete WebRTC session description. Both participants should restart with the latest app version and try a new room.')
  }
  return { type: description.type, sdp: description.sdp }
}

export class FirebaseCollaboration {
  readonly code: string
  readonly roomName: string
  readonly uid: string
  readonly hostUid: string
  readonly isHost: boolean

  private readonly database: Database
  private readonly callbacks: SessionCallbacks
  private readonly document = new Y.Doc()
  private readonly objects = this.document.getMap<CanvasItem>('objects')
  private readonly order = this.document.getArray<string>('order')
  private readonly connections = new Map<string, PeerConnection>()
  private readonly peerNames = new Map<string, string>()
  private readonly pendingSignals = new Map<string, NonNullable<CollaborationEvent['payload']>[]>()
  private readonly signalQueues = new Map<string, Promise<void>>()
  private readonly unsubscribers: Unsubscribe[] = []
  private readonly displayName: string
  private readonly cursorColor: string
  private cursorPoint: Point = { x: 0, y: 0 }
  private cursorVisible = false
  private selectedIds: string[] = []
  private marquee: CanvasRect | null = null
  private presenceWritePending = false
  private cursorTimer: ReturnType<typeof setTimeout> | null = null
  private cursorWriteQueue: Promise<void> = Promise.resolve()
  private lastCursorWriteAt = 0
  private cursorWriteErrorReported = false
  private transferId = 0
  private joined = false
  private canPublish = false
  private disposed = false
  private renderQueued = false

  private constructor(options: {
    code: string
    roomName: string
    uid: string
    hostUid: string
    isHost: boolean
    displayName: string
    database: Database
    callbacks: SessionCallbacks
  }) {
    this.code = options.code
    this.roomName = options.roomName
    this.uid = options.uid
    this.hostUid = options.hostUid
    this.isHost = options.isHost
    this.displayName = options.displayName
    this.cursorColor = CURSOR_COLORS[[...this.uid].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % CURSOR_COLORS.length]
    this.database = options.database
    this.callbacks = options.callbacks
    this.objects.observe(this.handleDocumentChange)
    this.order.observe(this.handleDocumentChange)
    this.document.on('update', this.handleDocumentUpdate)
    if (this.isHost) {
      this.joined = true
      this.canPublish = true
      this.setItems(options.callbacks.initialItems)
      this.listenForMembers()
      this.listenForSignals()
      this.listenForJoinRequests()
      this.startCursorPresence()
    } else {
      this.listenForOwnRequest()
      this.listenForOwnMembership()
    }
    this.listenForHostPresence()
  }

  static async host(name: string, callbacks: SessionCallbacks) {
    callbacks.onStatus('Signing in to Firebase anonymously…')
    const { database, uid } = await getFirebaseServices()
    let code = ''
    let reserved = false
    for (let attempt = 0; attempt < 5 && !reserved; attempt++) {
      callbacks.onStatus(`Reserving a room code in Realtime Database (attempt ${attempt + 1}/5)…`)
      code = createRoomCode()
      const result = await withTimeout(
        runTransaction(ref(database, roomPath(code, 'hostUid')), (current) => current === null ? uid : undefined, { applyLocally: false }),
        'Timed out while reserving a room code in Realtime Database. Check the database URL in .env.local, your internet connection, and the deployed database rules.',
      )
      reserved = result.committed
    }
    if (!reserved) throw new Error('Could not reserve a unique room code. Please try again.')
    try {
      callbacks.onStatus('Setting up the room…')
      await withTimeout(
        Promise.all([
          set(ref(database, roomPath(code, 'hostName')), name.trim().slice(0, 60) || 'MathCanvas host'),
          set(ref(database, roomPath(code, 'createdAt')), Date.now()),
          set(ref(database, roomPath(code, `members/${uid}`)), { name: name.trim().slice(0, 60) || 'MathCanvas host', joinedAt: Date.now() }),
          onDisconnect(ref(database, roomPath(code))).remove(),
        ]),
        'Timed out while configuring the room in Realtime Database. Confirm that you published the MathCanvas database rules and that the database URL is correct.',
      )
    } catch (error) {
      try {
        await remove(ref(database, roomPath(code)))
      } catch (cleanupError) {
        const originalMessage = error instanceof Error ? error.message : String(error)
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        throw new Error(`Could not create the collaboration room (${originalMessage}); cleanup also failed (${cleanupMessage}).`)
      }
      throw error
    }
    return new FirebaseCollaboration({
      code,
      roomName: name.trim().slice(0, 60) || 'MathCanvas room',
      uid,
      hostUid: uid,
      isHost: true,
      displayName: name.trim().slice(0, 60) || 'MathCanvas host',
      database,
      callbacks,
    })
  }

  static async join(codeInput: string, name: string, callbacks: SessionCallbacks) {
    const code = codeInput.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '')
    if (code.length !== 16) throw new Error('Enter the complete 16-character room code.')
    callbacks.onStatus('Signing in to Firebase anonymously…')
    const { database, uid } = await getFirebaseServices()
    callbacks.onStatus('Looking up the invite code in Firebase…')
    const [hostSnapshot, nameSnapshot] = await withTimeout(
      Promise.all([
        get(ref(database, roomPath(code, 'hostUid'))),
        get(ref(database, roomPath(code, 'hostName'))),
      ]),
      'Timed out while looking up the room. Check the Realtime Database URL, your internet connection, and whether the host is still online.',
    )
    const hostUid = hostSnapshot.val()
    if (typeof hostUid !== 'string' || !hostUid) throw new Error('That room is no longer active. Ask the host for a new code.')
    if (hostUid === uid) throw new Error('You are already hosting this room.')
    const session = new FirebaseCollaboration({
      code,
      roomName: String(nameSnapshot.val() ?? 'MathCanvas room'),
      uid,
      hostUid,
      isHost: false,
      displayName: name.trim().slice(0, 60) || 'MathCanvas peer',
      database,
      callbacks,
    })
    const requestRef = ref(database, roomPath(code, `requests/${uid}`))
    try {
      callbacks.onStatus('Sending your request to the host…')
      await withTimeout(
        Promise.all([
          onDisconnect(requestRef).remove(),
          onDisconnect(ref(database, roomPath(code, `members/${uid}`))).remove(),
        ]),
        'Timed out while preparing the join request. Check your connection and the Realtime Database rules.',
      )
      await withTimeout(
        set(requestRef, { name: name.trim().slice(0, 60) || 'MathCanvas peer', requestedAt: Date.now(), status: 'pending' }),
        'Timed out while sending the join request. Check that the host is online and the Realtime Database rules are published.',
      )
    } catch (error) {
      session.dispose()
      try {
        await remove(requestRef)
      } catch (cleanupError) {
        const originalMessage = error instanceof Error ? error.message : String(error)
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        throw new Error(`Could not send the join request (${originalMessage}); cleanup also failed (${cleanupMessage}).`)
      }
      throw error
    }
    callbacks.onStatus(`Join request sent to “${session.roomName}”. Waiting for host approval.`)
    return session
  }

  setItems = (items: CanvasItem[]) => {
    if (!this.canPublish) return
    this.document.transact(() => {
      const itemIds = new Set(items.map((item) => item.id))
      for (const id of [...this.objects.keys()]) if (!itemIds.has(id)) this.objects.delete(id)
      for (const item of items) {
        const current = this.objects.get(item.id)
        if (JSON.stringify(current) !== JSON.stringify(item)) this.objects.set(item.id, item)
      }
      const currentOrder = this.order.toArray()
      const nextOrder = items.map((item) => item.id)
      if (currentOrder.length !== nextOrder.length || currentOrder.some((id, index) => id !== nextOrder[index])) {
        if (currentOrder.length) this.order.delete(0, currentOrder.length)
        if (nextOrder.length) this.order.insert(0, nextOrder)
      }
    }, 'local')
  }

  updateCursor = (point: Point | null) => {
    if (!this.joined || this.disposed) return
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      this.cursorPoint = point
      this.cursorVisible = true
    } else {
      this.cursorVisible = false
    }
    this.scheduleCursorWrite()
  }

  updateSelection = (selectedIds: string[]) => {
    if (this.disposed) return
    this.selectedIds = [...new Set(selectedIds)].slice(0, 100)
    if (this.joined) this.scheduleCursorWrite()
  }

  updateMarquee = (bounds: CanvasRect | null) => {
    if (this.disposed) return
    this.marquee = bounds && [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)
      ? { x: bounds.x, y: bounds.y, w: Math.max(0, bounds.w), h: Math.max(0, bounds.h) }
      : null
    if (this.joined) this.scheduleCursorWrite()
  }

  handleEvent = (event: CollaborationEvent) => {
    if (this.disposed) return
    if (event.type === 'signal' && event.from && event.payload) void this.receiveSignal(event.from, event.payload)
    if (event.type === 'request-denied') this.callbacks.onStatus('The host declined the request to join.')
  }

  approve = async (peerId: string, approved: boolean) => {
    if (!this.isHost) throw new Error('Only the host can approve room access.')
    const requestRef = ref(this.database, roomPath(this.code, `requests/${peerId}`))
    if (approved) {
      const request = (await get(requestRef)).val()
      if (!request || request.status !== 'pending') throw new Error('That join request is no longer waiting.')
      await set(ref(this.database, roomPath(this.code, `members/${peerId}`)), { name: String(request.name ?? 'MathCanvas peer').slice(0, 60), joinedAt: Date.now() })
      await update(requestRef, { status: 'approved' })
    } else {
      await update(requestRef, { status: 'denied' })
    }
  }

  leave = async () => {
    await this.clearCursorPresence()
    if (this.isHost) {
      await remove(ref(this.database, roomPath(this.code)))
    } else {
      await Promise.all([
        remove(ref(this.database, roomPath(this.code, `members/${this.uid}`))),
        remove(ref(this.database, roomPath(this.code, `requests/${this.uid}`))),
      ])
    }
    this.dispose()
  }

  dispose = () => {
    if (this.disposed) return
    this.disposed = true
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    if (this.cursorTimer) clearTimeout(this.cursorTimer)
    this.cursorTimer = null
    for (const peer of this.connections.values()) {
      peer.channel?.close()
      peer.connection.close()
    }
    this.connections.clear()
    this.pendingSignals.clear()
    this.signalQueues.clear()
    this.callbacks.onCursors([])
    this.document.destroy()
  }

  private listenForMembers() {
    const membersRef = ref(this.database, roomPath(this.code, 'members'))
    this.unsubscribers.push(onChildAdded(membersRef, (snapshot) => this.memberAdded(snapshot)))
    this.unsubscribers.push(onChildRemoved(membersRef, (snapshot) => {
      const peerId = snapshot.key
      if (!peerId) return
      if (!this.isHost && peerId === this.uid) {
        if (!this.joined) this.callbacks.onStatus('The host ended this room.')
        return
      }
      this.connections.get(peerId)?.connection.close()
      this.connections.delete(peerId)
      this.peerNames.delete(peerId)
      this.pendingSignals.delete(peerId)
      this.signalQueues.delete(peerId)
      this.updatePeerList()
    }))
  }

  private startCursorPresence() {
    const cursorsRef = ref(this.database, roomPath(this.code, 'cursors'))
    void onDisconnect(ref(this.database, roomPath(this.code, `cursors/${this.uid}`))).remove().catch((error: unknown) => {
      this.callbacks.onStatus(`Could not register cursor cleanup: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.unsubscribers.push(onValue(cursorsRef, (snapshot) => {
      const cursors: RemoteCursor[] = []
      snapshot.forEach((child) => {
        if (!child.key || child.key === this.uid) return
        const value = child.val() as { name?: unknown; x?: unknown; y?: unknown; color?: unknown; visible?: unknown; selectedIds?: unknown; marquee?: unknown } | null
        if (typeof value?.name !== 'string' || typeof value.x !== 'number' || typeof value.y !== 'number' || typeof value.color !== 'string') return
        if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return
        const selectedIds = Array.isArray(value.selectedIds)
          ? value.selectedIds.filter((id): id is string => typeof id === 'string').slice(0, 100)
          : []
        const marqueeValue = value.marquee as Partial<CanvasRect> | null
        const marquee = marqueeValue && [marqueeValue.x, marqueeValue.y, marqueeValue.w, marqueeValue.h].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
          ? { x: marqueeValue.x!, y: marqueeValue.y!, w: marqueeValue.w!, h: marqueeValue.h! }
          : null
        cursors.push({ peerId: child.key, name: value.name.slice(0, 60), x: value.x, y: value.y, color: value.color, visible: value.visible !== false, selectedIds, marquee })
      })
      this.callbacks.onCursors(cursors)
    }, (error) => this.callbacks.onStatus(`Could not receive remote cursors: ${error.message}`)))
    this.scheduleCursorWrite()
  }

  private scheduleCursorWrite() {
    if (this.cursorTimer || this.disposed) return
    this.presenceWritePending = true
    const delay = Math.max(0, PRESENCE_THROTTLE_MS - (Date.now() - this.lastCursorWriteAt))
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null
      this.presenceWritePending = false
      void this.enqueuePresenceWrite().finally(() => {
        if (this.presenceWritePending) this.scheduleCursorWrite()
      })
    }, delay)
  }

  private enqueuePresenceWrite() {
    const cursorRef = ref(this.database, roomPath(this.code, `cursors/${this.uid}`))
    this.cursorWriteQueue = this.cursorWriteQueue.then(async () => {
      if (this.disposed) return
      await set(cursorRef, {
        name: this.displayName,
        x: this.cursorPoint.x,
        y: this.cursorPoint.y,
        color: this.cursorColor,
        visible: this.cursorVisible,
        selectedIds: this.selectedIds.length ? this.selectedIds : null,
        marquee: this.marquee,
      })
      this.lastCursorWriteAt = Date.now()
      this.cursorWriteErrorReported = false
    }).catch((error: unknown) => {
      if (!this.cursorWriteErrorReported) {
        this.callbacks.onStatus(`Could not share your cursor: ${error instanceof Error ? error.message : String(error)}. Check the published Realtime Database rules.`)
        this.cursorWriteErrorReported = true
      }
    })
    return this.cursorWriteQueue
  }

  private async clearCursorPresence() {
    if (this.cursorTimer) clearTimeout(this.cursorTimer)
    this.cursorTimer = null
    this.presenceWritePending = false
    await this.cursorWriteQueue
    await remove(ref(this.database, roomPath(this.code, `cursors/${this.uid}`)))
  }

  private listenForHostPresence() {
    this.unsubscribers.push(onValue(ref(this.database, roomPath(this.code, 'hostUid')), (snapshot) => {
      if (!snapshot.exists() && !this.isHost && !this.disposed) this.callbacks.onStatus('The host ended this room.')
    }))
  }

  private listenForOwnMembership() {
    this.unsubscribers.push(onValue(ref(this.database, roomPath(this.code, `members/${this.uid}`)), (snapshot) => {
      if (snapshot.exists() && !this.joined) {
        this.joined = true
        this.callbacks.onStatus(`Connected to “${this.roomName}”. Canvas updates are shared peer-to-peer.`)
        this.listenForMembers()
        this.listenForSignals()
        this.startCursorPresence()
      }
    }))
  }

  private memberAdded(snapshot: DataSnapshot) {
    const peerId = snapshot.key
    if (!peerId) return
    const member = snapshot.val() as { name?: unknown } | null
    const name = String(member?.name ?? 'Collaborator').slice(0, 60)
    this.peerNames.set(peerId, name)
    if (peerId === this.uid) return
    if (this.joined && peerId !== this.uid) this.ensurePeer(peerId, name)
    this.updatePeerList()
  }

  private listenForJoinRequests() {
    const requestsRef = ref(this.database, roomPath(this.code, 'requests'))
    this.unsubscribers.push(onChildAdded(requestsRef, (snapshot) => this.notifyJoinRequest(snapshot)))
    this.unsubscribers.push(onChildRemoved(requestsRef, (snapshot) => {
      if (snapshot.key) this.callbacks.onJoinRequestRemoved(snapshot.key)
    }))
  }

  private notifyJoinRequest(snapshot: DataSnapshot) {
    const peerId = snapshot.key
    const request = snapshot.val() as { name?: unknown; status?: unknown } | null
    if (!peerId || !request || request.status !== 'pending') return
    this.callbacks.onJoinRequest({ peerId, name: String(request.name ?? 'MathCanvas peer').slice(0, 60) })
  }

  private listenForOwnRequest() {
    const requestRef = ref(this.database, roomPath(this.code, `requests/${this.uid}`))
    this.unsubscribers.push(onValue(requestRef, (snapshot) => {
      const status = snapshot.child('status').val()
      if (status === 'denied') this.handleEvent({ type: 'request-denied' })
      if (status === 'approved') {
        void remove(requestRef).catch((error: unknown) => {
          this.callbacks.onStatus(`Could not clear the approved join request: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
    }))
  }

  private listenForSignals() {
    const inboxRef = ref(this.database, roomPath(this.code, `signals/${this.uid}`))
    this.unsubscribers.push(onChildAdded(inboxRef, (snapshot) => {
      const message = snapshot.val() as { from?: unknown; payload?: CollaborationEvent['payload'] } | null
      if (message && typeof message.from === 'string' && message.payload) {
        this.handleEvent({ type: 'signal', from: message.from, payload: message.payload })
      }
      void remove(snapshot.ref).catch((error: unknown) => {
        this.callbacks.onStatus(`Could not clear a processed signaling message: ${error instanceof Error ? error.message : String(error)}`)
      })
    }))
  }

  private updatePeerList() {
    this.callbacks.onPeers([...this.connections.keys()].map((peerId) => ({ peerId, name: this.peerNames.get(peerId) ?? 'Collaborator' })))
  }

  private readonly handleDocumentChange = (_event: unknown, transaction: Y.Transaction) => {
    if (transaction.origin === 'local' || this.renderQueued) return
    this.renderQueued = true
    queueMicrotask(() => {
      this.renderQueued = false
      if (this.disposed) return
      this.callbacks.onItems(this.currentItems())
    })
  }

  private currentItems() {
    const orderedIds = [...new Set(this.order.toArray())]
    const seen = new Set(orderedIds)
    const items = orderedIds.flatMap((id) => {
      const item = this.objects.get(id)
      return item ? [item] : []
    })
    for (const [id, item] of this.objects) if (!seen.has(id)) items.push(item)
    return items
  }

  private ensurePeer(peerId: string, name: string) {
    if (this.disposed || peerId === this.uid || this.connections.has(peerId)) return
    this.peerNames.set(peerId, name)
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const peer: PeerConnection = { connection, parts: new Map(), queue: [], pendingCandidates: [] }
    this.connections.set(peerId, peer)
    this.updatePeerList()
    const pendingSignals = this.pendingSignals.get(peerId)
    this.pendingSignals.delete(peerId)
    for (const payload of pendingSignals ?? []) this.queueSignal(peerId, payload)
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) void this.sendSignal(peerId, { type: 'candidate', candidate: candidate.toJSON() })
    }
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
        this.callbacks.onStatus(`Direct connection to ${name} ${connection.connectionState}. Some network setups require a TURN relay.`)
      }
    }
    connection.ondatachannel = (event) => this.attachChannel(peerId, peer, event.channel)
    if (this.uid < peerId) {
      this.attachChannel(peerId, peer, connection.createDataChannel('mathcanvas', { ordered: true }))
      void connection.createOffer().then((offer) => connection.setLocalDescription(offer)).then(() => {
        return this.sendSignal(peerId, { type: 'description', description: serializeDescription(connection.localDescription) })
      }).catch((error: unknown) => this.callbacks.onStatus(`Could not start a direct peer connection: ${error instanceof Error ? error.message : String(error)}`))
    }
  }

  private attachChannel(peerId: string, peer: PeerConnection, channel: RTCDataChannel) {
    peer.channel = channel
    channel.binaryType = 'arraybuffer'
    channel.bufferedAmountLowThreshold = 512 * 1024
    channel.onopen = () => {
      this.callbacks.onStatus('Direct peer connection established. Canvas data is flowing peer-to-peer.')
      if (this.isHost) {
        peer.initialSyncPending = true
        this.queueUpdate(peer, Y.encodeStateAsUpdate(this.document))
        this.flushQueue(peer)
      }
    }
    channel.onbufferedamountlow = () => this.flushQueue(peer)
    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) this.receiveChunk(peerId, peer, new Uint8Array(event.data))
      else if (event.data === 'mathcanvas-sync-complete' && !this.canPublish) {
        this.canPublish = true
        this.callbacks.onItems(this.currentItems())
      }
    }
    channel.onclose = () => this.callbacks.onStatus('A direct peer connection closed.')
  }

  private async sendSignal(peerId: string, payload: NonNullable<CollaborationEvent['payload']>) {
    if (this.disposed) return
    try {
      await set(push(ref(this.database, roomPath(this.code, `signals/${peerId}`))), {
        from: this.uid,
        payload,
        sentAt: Date.now(),
      })
    } catch (error) {
      this.callbacks.onStatus(`Could not relay peer connection details through Firebase: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private receiveSignal(peerId: string, payload: NonNullable<CollaborationEvent['payload']>) {
    if (!this.peerNames.has(peerId) || !this.connections.has(peerId)) {
      const pending = this.pendingSignals.get(peerId) ?? []
      if (pending.length >= MAX_PENDING_SIGNALS_PER_PEER) {
        this.callbacks.onStatus(`Too many WebRTC signaling messages arrived before ${this.peerNames.get(peerId) ?? 'the peer'} was ready.`)
        return
      }
      pending.push(payload)
      this.pendingSignals.set(peerId, pending)
      return
    }
    this.queueSignal(peerId, payload)
  }

  private queueSignal(peerId: string, payload: NonNullable<CollaborationEvent['payload']>) {
    const previous = this.signalQueues.get(peerId) ?? Promise.resolve()
    const next = previous.then(() => this.processSignal(peerId, payload)).catch((error: unknown) => {
      this.callbacks.onStatus(`Could not negotiate a direct peer connection: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.signalQueues.set(peerId, next)
  }

  private async processSignal(peerId: string, payload: NonNullable<CollaborationEvent['payload']>) {
    const peer = this.connections.get(peerId)
    if (!peer) return
    if (payload.type === 'description') {
      const description = parseDescription(payload.description)
      await peer.connection.setRemoteDescription(description)
      for (const candidate of peer.pendingCandidates.splice(0)) await peer.connection.addIceCandidate(candidate)
      if (description.type === 'offer') {
        const answer = await peer.connection.createAnswer()
        await peer.connection.setLocalDescription(answer)
        await this.sendSignal(peerId, { type: 'description', description: serializeDescription(peer.connection.localDescription) })
      }
    } else if (peer.connection.remoteDescription) {
      await peer.connection.addIceCandidate(payload.candidate)
    } else {
      peer.pendingCandidates.push(payload.candidate)
    }
  }

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    for (const [peerId, peer] of this.connections) {
      if (origin === peerId || peer.channel?.readyState !== 'open') continue
      this.queueUpdate(peer, update)
      this.flushQueue(peer)
    }
  }

  private queueUpdate(peer: PeerConnection, update: Uint8Array) {
    const transferId = ++this.transferId
    const total = Math.ceil(update.length / CHUNK_SIZE)
    for (let index = 0; index < total; index++) {
      const start = index * CHUNK_SIZE
      const chunk = update.subarray(start, Math.min(update.length, start + CHUNK_SIZE))
      const packet = new Uint8Array(CHUNK_HEADER_SIZE + chunk.length)
      const header = new DataView(packet.buffer)
      header.setUint32(0, transferId)
      header.setUint32(4, index)
      header.setUint32(8, total)
      packet.set(chunk, CHUNK_HEADER_SIZE)
      peer.queue.push(packet)
    }
  }

  private flushQueue(peer: PeerConnection) {
    const channel = peer.channel
    if (!channel || channel.readyState !== 'open') return
    while (peer.queue.length && channel.bufferedAmount < 512 * 1024) {
      try {
        const queued = peer.queue.shift()!
        const packet = new Uint8Array(queued.byteLength)
        packet.set(queued)
        channel.send(packet)
      } catch (error) {
        this.callbacks.onStatus(`Could not send a canvas update: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }
    if (!peer.queue.length && peer.initialSyncPending && channel.readyState === 'open') {
      peer.initialSyncPending = false
      channel.send('mathcanvas-sync-complete')
    }
  }

  private receiveChunk(peerId: string, peer: PeerConnection, packet: Uint8Array) {
    if (packet.byteLength < CHUNK_HEADER_SIZE) return
    const header = new DataView(packet.buffer, packet.byteOffset, CHUNK_HEADER_SIZE)
    const transferId = header.getUint32(0)
    const index = header.getUint32(4)
    const total = header.getUint32(8)
    if (!total || total * CHUNK_SIZE > MAX_TRANSFER_BYTES || index >= total) {
      this.callbacks.onStatus('A peer sent an invalid or oversized canvas update.')
      return
    }
    let transfer = peer.parts.get(transferId)
    if (!transfer) {
      if (peer.parts.size >= MAX_PENDING_TRANSFERS) {
        this.callbacks.onStatus('Too many canvas updates are arriving at once.')
        return
      }
      transfer = { total, chunks: new Array<Uint8Array>(total), received: 0 }
      peer.parts.set(transferId, transfer)
    }
    if (transfer.total !== total || transfer.chunks[index]) return
    transfer.chunks[index] = packet.slice(CHUNK_HEADER_SIZE)
    transfer.received++
    if (transfer.received !== total) return
    const size = transfer.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const update = new Uint8Array(size)
    let offset = 0
    for (const chunk of transfer.chunks) {
      update.set(chunk, offset)
      offset += chunk.length
    }
    peer.parts.delete(transferId)
    try { Y.applyUpdate(this.document, update, peerId) } catch (error) {
      this.callbacks.onStatus(`Could not apply a canvas update: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
