/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_FIREBASE_API_KEY: string
    readonly VITE_FIREBASE_AUTH_DOMAIN: string
    readonly VITE_FIREBASE_DATABASE_URL: string
    readonly VITE_FIREBASE_PROJECT_ID: string
    readonly VITE_FIREBASE_APP_ID: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }

  interface Window {
    mathCanvas?: {
      checkForUpdates(): Promise<{ version: string; currentVersion: string; releaseUrl: string; downloadUrl: string; notes: string } | null>
      openUpdateDownload(url: string): Promise<void>
      saveAs(json: string): Promise<{ canceled: boolean; filePath?: string }>
      save(filePath: string, json: string): Promise<{ canceled: boolean; filePath?: string }>
      open(): Promise<{ canceled: boolean; filePath?: string; json?: string }>
      autosave(json: string): Promise<{ filePath: string }>
      loadAutosave(): Promise<{ exists: boolean; json?: string }>
      exportText(text: string): Promise<{ canceled: boolean; filePath?: string }>
      solveProblem(requestId: string, imageBase64: string, systemPrompt: string, model: string, onChunk: (text: string) => void): Promise<string>
      cancelProblem(requestId: string): Promise<void>
    }
  }
}

export {}
