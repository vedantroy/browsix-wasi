const fs = require('fs-extra')
fs.copySync('dist/index.js', '../browsix/fs/wasm_test.js')