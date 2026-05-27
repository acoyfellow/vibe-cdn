export type Env = {
  ASSETS: R2Bucket
  DB: D1Database
  SAVES: KVNamespace
  LOBBY: DurableObjectNamespace
  APP_ASSETS?: Fetcher
  ENVIRONMENT?: string
  ALLOW_DEV_UPLOADS?: string
}
