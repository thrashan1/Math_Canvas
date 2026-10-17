export type PhysicsBody = {
  id: string
  label: string
  x: number
  y: number
  radius: number
  mass: number
  friction: number
  color: string
  vx: number
  vy: number
}

export type PhysicsStructure = {
  id: string
  type: 'surface' | 'wall' | 'string'
  label: string
  x1: number
  y1: number
  x2: number
  y2: number
  friction: number
  bodyId?: string
  tension?: number
}

export type PhysicsForce = {
  id: string
  label: string
  bodyId: string
  magnitude: number
  angle: number
  color: string
}

export type PhysicsDocument = {
  version: 1
  mode: 'static' | 'simulation'
  gravity: number
  autoBalanceForces?: boolean
  bodies: PhysicsBody[]
  structures: PhysicsStructure[]
  forces: PhysicsForce[]
}

export type PhysicsVector = { x: number; y: number; label: string; color: string; magnitude: number; angle: number }

export const PHYSICS_SCENE_WIDTH = 1000
export const PHYSICS_SCENE_HEIGHT = 680
export const PHYSICS_PIXELS_PER_METER = 55
export const PHYSICS_LOOP_SECONDS = 8

export const makePhysicsId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `physics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function makePhysicsDocument(): PhysicsDocument {
  const bodyId = makePhysicsId()
  return {
    version: 1,
    mode: 'static',
    gravity: 9.8,
    autoBalanceForces: true,
    bodies: [{ id: bodyId, label: 'Block A', x: 500, y: 410, radius: 26, mass: 5, friction: 0.3, color: '#eff6ff', vx: 0, vy: 0 }],
    structures: [
      { id: makePhysicsId(), type: 'string', label: 'String 1', x1: 500, y1: 410, x2: 350, y2: 150, friction: 0, bodyId, tension: 28.29 },
      { id: makePhysicsId(), type: 'string', label: 'String 2', x1: 500, y1: 410, x2: 650, y2: 150, friction: 0, bodyId, tension: 28.29 },
    ],
    forces: [],
  }
}

export function getBodyForces(document: PhysicsDocument, body: PhysicsBody): PhysicsVector[] {
  const vectors: PhysicsVector[] = [{
    label: 'Weight',
    color: '#dc2626',
    magnitude: body.mass * document.gravity,
    angle: 270,
    x: 0,
    y: body.mass * document.gravity,
  }]
  for (const force of document.forces.filter((candidate) => candidate.bodyId === body.id)) {
    const radians = force.angle * Math.PI / 180
    vectors.push({
      label: force.label,
      color: force.color,
      magnitude: force.magnitude,
      angle: force.angle,
      x: force.magnitude * Math.cos(radians),
      y: -force.magnitude * Math.sin(radians),
    })
  }
  for (const structure of document.structures.filter((candidate) => candidate.type === 'string' && candidate.bodyId === body.id)) {
    const dx = structure.x2 - structure.x1
    const dy = structure.y2 - structure.y1
    const angle = Math.atan2(-dy, dx) * 180 / Math.PI
    const radians = angle * Math.PI / 180
    const magnitude = Math.max(0, structure.tension ?? 0)
    vectors.push({
      label: structure.label,
      color: '#0f766e',
      magnitude,
      angle,
      x: magnitude * Math.cos(radians),
      y: -magnitude * Math.sin(radians),
    })
  }
  return vectors
}

export function getNetForce(document: PhysicsDocument, body: PhysicsBody) {
  return getBodyForces(document, body).reduce((net, force) => ({ x: net.x + force.x, y: net.y + force.y }), { x: 0, y: 0 })
}

function closestPointOnSegment(x: number, y: number, structure: PhysicsStructure) {
  const dx = structure.x2 - structure.x1
  const dy = structure.y2 - structure.y1
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, ((x - structure.x1) * dx + (y - structure.y1) * dy) / lengthSquared)) : 0
  return { x: structure.x1 + dx * t, y: structure.y1 + dy * t }
}

export function stepPhysics(document: PhysicsDocument, bodies: PhysicsBody[], seconds: number): PhysicsBody[] {
  const dt = Math.max(0, Math.min(0.04, seconds))
  if (!dt) return bodies
  const moving = bodies.map((body) => {
    const net = document.autoBalanceForces === false ? getNetForce(document, body) : { x: 0, y: 0 }
    const mass = Math.max(0.01, body.mass)
    const nextVx = body.vx + net.x / mass * dt
    const nextVy = body.vy - net.y / mass * dt
    return {
      ...body,
      vx: nextVx,
      vy: nextVy,
      x: body.x + (body.vx + nextVx) / 2 * PHYSICS_PIXELS_PER_METER * dt,
      y: body.y - (body.vy + nextVy) / 2 * PHYSICS_PIXELS_PER_METER * dt,
    }
  })
  for (const body of moving) {
    for (const structure of document.structures) {
      if (structure.type === 'string') continue
      const closest = closestPointOnSegment(body.x, body.y, structure)
      let dx = body.x - closest.x
      let dy = body.y - closest.y
      let distance = Math.hypot(dx, dy)
      if (distance >= body.radius) continue
      if (distance < 0.001) {
        const sx = structure.x2 - structure.x1
        const sy = structure.y2 - structure.y1
        const length = Math.max(1, Math.hypot(sx, sy))
        dx = -sy / length
        dy = sx / length
        distance = 1
      } else {
        dx /= distance
        dy /= distance
      }
      body.x += dx * (body.radius - distance)
      body.y += dy * (body.radius - distance)
      const screenVx = body.vx
      let screenVy = -body.vy
      const normalSpeed = screenVx * dx + screenVy * dy
      if (normalSpeed >= 0) continue
      body.vx -= 1.35 * normalSpeed * dx
      screenVy -= 1.35 * normalSpeed * dy
      const tangentX = -dy
      const tangentY = dx
      const tangentSpeed = body.vx * tangentX + screenVy * tangentY
      const friction = Math.sqrt(Math.max(0, structure.friction) * Math.max(0, body.friction)) * Math.abs(normalSpeed)
      const reducedSpeed = Math.sign(tangentSpeed) * Math.max(0, Math.abs(tangentSpeed) - friction)
      body.vx += (reducedSpeed - tangentSpeed) * tangentX
      screenVy += (reducedSpeed - tangentSpeed) * tangentY
      body.vy = -screenVy
    }
  }
  return moving
}

export function getSimulatedBodies(document: PhysicsDocument, seconds: number): PhysicsBody[] {
  const target = Math.max(0, Math.min(PHYSICS_LOOP_SECONDS, seconds))
  const steps = Math.ceil(target * 60)
  let bodies = document.bodies.map((body) => ({ ...body }))
  let elapsed = 0
  for (let index = 0; index < steps; index++) {
    const dt = Math.min(1 / 60, target - elapsed)
    bodies = stepPhysics(document, bodies, dt)
    elapsed += dt
  }
  return bodies
}
