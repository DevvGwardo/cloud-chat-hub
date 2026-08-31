// factory.ts — mounts factory routes directly (no dynamic import race)
// keeps logic in sync with ~/software-factory/src/adapters/cloud-chat-hub.ts
import type { Express, Request, Response } from 'express';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// lightweight queue — mirrors ~/software-factory/src/engine/pipeline.ts FactoryQueue
type Job = { jobId:string; stage:string; task:string; workdir:string; createdAt:string; updatedAt:string };
const jobs = new Map<string, Job>();

function nextJobId(){ return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`; }

export function registerFactoryRoutes(app: Express){
  // status: queue length + uptime + factory presence
  app.get('/api/factory/status', (_req: Request, res: Response)=>{
    const factoryOk = existsSync(join(homedir(),'software-factory/package.json'));
    const harnessOk = existsSync(join(homedir(),'spark-harness/index.js'));
    res.json({ ok:true, factory: factoryOk ? 'installed' : 'missing', harness: harnessOk ? 'present' : 'missing', queue: jobs.size, jobs: [...jobs.values()] });
  });
  app.get('/api/factory/queue', (_req: Request, res: Response)=>{
    res.json({ ok:true, jobs: [...jobs.values()] });
  });
  app.post('/api/factory/dispatch', (req: Request, res: Response)=>{
    const { task, workdir } = (req.body||{}) as {task?:string; workdir?:string};
    if(!task || !String(task).trim()) return res.status(400).json({ error:'task required' });
    const id=nextJobId(); const now=new Date().toISOString();
    const job: Job={ jobId:id, stage:'intake', task: String(task), workdir: workdir||process.cwd(), createdAt:now, updatedAt:now };
    jobs.set(id, job);
    // also enqueue to ~/.agent-tasks for Hermes local worker
    try{
      const dir=join(homedir(),'.agent-tasks');
      mkdirSync(dir,{recursive:true});
      writeFileSync(join(dir,`${id}.json`), JSON.stringify({ id, title: task, prompt: task, workdir: job.workdir, createdAt:now },null,2));
    }catch{ /* ignore missing dir */ }
    // brain KV
    try{
      const bd=join(homedir(),'.cache/factory-brain');
      mkdirSync(bd,{recursive:true}); writeFileSync(join(bd,`factory_job_${id}.json`), JSON.stringify(job));
    }catch{ /* ignore */ }
    res.json({ ok:true, job });
  });
  app.post('/api/factory/kanban/sync', (_req: Request, res: Response)=>{
    const kanbanDb=join(homedir(),'.hermes/kanban.db');
    res.json({ ok:true, kanban: kanbanDb, exists: existsSync(kanbanDb), orchestrator:'/api/hermes/orchestrator/*', hint:'task-queue ~/.agent-tasks + brain KV claim/release in ~/software-factory/src/lib/queue-mcp.ts' });
  });
  // also expose vercel/railway health proxies
  app.get('/api/factory/health', (_req: Request, res: Response)=>{
    res.json({ ok:true, routes:['/api/factory/status','/api/factory/queue','/api/factory/dispatch','/api/factory/kanban/sync','/api/factory/health'], factory:'~/software-factory', harness:'~/spark-harness' });
  });
}
