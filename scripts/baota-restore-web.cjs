const fs = require('node:fs')
const path = require('node:path')
function restoreWeb(backup, target) {
  if (fs.statSync(backup).dev !== fs.statSync(target).dev) throw Error('Static rollback requires the backup and Web directory on the same filesystem')
  let restored = 0
  function visit(relative = '') {
    for (const item of fs.readdirSync(path.join(backup, relative), {withFileTypes: true})) {
      if (item.name === '.user.ini') continue
      const source = path.join(backup, relative, item.name), destination = path.join(target, relative, item.name)
      if (item.isDirectory()) { fs.mkdirSync(destination, {recursive: true}); visit(path.join(relative, item.name)) }
      else if (item.isFile()) {
        // Consume the prepared rollback copy with same-disk atomic renames;
        // restore unhashed static files without needing more free disk space.
        fs.renameSync(source, destination)
        restored++
      } else throw Error('Unexpected non-file in static rollback copy')
    }
  }
  visit()
  return restored
}
module.exports = {restoreWeb}
if (require.main === module) console.log(`Restored ${restoreWeb(process.argv[2], process.argv[3])} previous static files, including unhashed assets`)
