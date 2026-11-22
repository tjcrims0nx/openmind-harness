/** Sequential, resumable workflow definitions. Task handlers execute only known operations. */
export function validateWorkflow(def,registeredKinds){
  if(!def||typeof def.name!=='string'||!Array.isArray(def.steps)||def.steps.length<1||def.steps.length>50)throw new TypeError('Invalid workflow');
  if(def.steps.some(s=>!s||typeof s.kind!=='string'||!registeredKinds.includes(s.kind)||typeof s.input!=='object'||s.input===null))throw new TypeError('Unknown workflow step');
  return {name:def.name,steps:def.steps.map(s=>({kind:s.kind,input:structuredClone(s.input)}))};
}
export class WorkflowRunner {
  constructor(queue){this.queue=queue;}
  async submit(def){const clean=validateWorkflow(def,Object.keys(this.queue.handlers));const ids=[];for(const step of clean.steps){const task=await this.queue.enqueue(step.kind,step.input);ids.push(task.id);}return {name:clean.name,taskIds:ids};}
  async executeSequential(def){const clean=validateWorkflow(def,Object.keys(this.queue.handlers));const results=[];for(const step of clean.steps){const task=await this.queue.enqueue(step.kind,step.input);const result=await this.queue.runNext();results.push(result);if(result.id!==task.id||result.status!=='completed')break;}return {name:clean.name,results};}
}
