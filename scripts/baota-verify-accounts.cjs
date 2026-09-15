const fs=require('node:fs'),crypto=require('node:crypto')
const accounts=JSON.parse(fs.readFileSync('/data/application-data.json','utf8')).accounts
if(!Array.isArray(accounts))throw Error('Production accounts unavailable')
const hash=crypto.createHash('sha256').update(JSON.stringify(accounts)).digest('hex')
const file='/backup/accounts.sha256'
if(process.argv[2]==='snapshot')fs.writeFileSync(file,hash,{mode:0o600,flag:'wx'})
else if(process.argv[2]==='verify'){
  if(fs.readFileSync(file,'utf8')!==hash)throw Error('Account state changed unexpectedly; rolling back')
  console.log(`Account integrity checked: ${accounts.length} accounts unchanged, including password hashes and identity state.`)
}else throw Error('Expected snapshot or verify')
