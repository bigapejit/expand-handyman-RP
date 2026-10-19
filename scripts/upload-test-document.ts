import { createClerkClient } from '@clerk/backend';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import { readFile, writeFile } from 'node:fs/promises';
import type { Id } from '../convex/_generated/dataModel';
async function main(){
  if(!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_') || !process.env.CONVEX_DEPLOYMENT?.startsWith('dev:')) throw new Error('Development only.');
  const fixture=JSON.parse(await readFile('test-results/browser-login.json','utf8'));
  const clerk=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
  const session=await clerk.sessions.createSession({userId:fixture.userId});
  try {
    const jwt=await clerk.sessions.getToken(session.id,'convex');
    const client=new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);client.setAuth(jwt.jwt);
    const customers=await client.query(api.customers.list,{});
    const customer=customers.find(c=>c.name==='Test Customer');if(!customer)throw new Error('Create the test customer through the UI first.');
    const bytes=await readFile('test-results/upload-test.pdf');
    const uploadUrl=await client.mutation(api.documents.uploadUrl,{});
    const response=await fetch(uploadUrl,{method:'POST',headers:{'Content-Type':'application/pdf'},body:new Uint8Array(bytes)});
    if(!response.ok)throw new Error('Upload failed');
    const {storageId}=await response.json();
    const id=await client.action(api.pdfActions.create,{storageId:storageId as Id<'_storage'>,customerId:customer._id,title:'Signing workflow test'});
    await writeFile('test-results/document.json',JSON.stringify({id,url:`http://localhost:3210/documents/${id}`}));
    console.log('Authenticated PDF upload and validation passed. Test document prepared.');
  } finally { await clerk.sessions.revokeSession(session.id); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
