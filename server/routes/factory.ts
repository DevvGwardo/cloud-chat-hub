// factory.ts — thin re-export: mounts ~/software-factory adapter when present
// keeps cloud-chat-hub decoupled; factory owns the logic
import { existsSync } from 'node:fs';
import type { Express, Request, Response } from 'express';
const FACTORY_ADAPTER = `${process.env.HOME}/software-factory/src/adapters/cloud-chat-hub.ts`;
export function registerFactoryRoutes(app: Express){
  if(!existsSync(FACTORY_ADAPTER)) { app.get('/api/factory/status', (_req: Request,res: Response)=> res.json({ ok:false, error:'factory not installed at ~/software-factory'})); return; }
  // dynamic import so cloud-chat-hub typecheck doesn't hard-depend on factory
  import(FACTORY_ADAPTER).then(m=> (m as {registerFactoryRoutes:(a:Express)=>void}).registerFactoryRoutes(app)).catch((e: Error)=> {
    app.get('/api/factory/status', (_req: Request,res: Response)=> res.json({ ok:false, error:String(e.message)}));
  });
}
