// Public market now shares the regional storefront. Run its current browser suite.
const {spawnSync}=require('node:child_process');const result=spawnSync(process.execPath,['--test','tests/market/browser.test.mjs'],{stdio:'inherit',env:process.env});process.exit(result.status??1);
