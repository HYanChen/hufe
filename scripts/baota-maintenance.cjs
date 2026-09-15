const fs = require('node:fs')
const {maintenanceConfig, atomicWrite} = require('./nginx.cjs')
const file = '/routes/hufe.pla.wiki.conf'
atomicWrite(file, maintenanceConfig(fs.readFileSync(file, 'utf8')))
console.log('Temporary API maintenance gate prepared; health and static pages stay available.')
