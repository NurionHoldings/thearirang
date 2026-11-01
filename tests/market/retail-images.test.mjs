import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {leaves} from '../../public/market-taxonomy.mjs';
import {leafEntries,leafImage,matchingLeafImages,displayImage,generatedImage} from '../../public/market-images.mjs';
test('every authoritative leaf has one real retail asset and sale unit',()=>{
 assert.equal(leafEntries.length,Object.values(leaves).flat().length);
 assert.equal(new Set(leafEntries.map(x=>x.src)).size,46);
 for(const x of leafEntries){assert(x.title&&x.unit);assert(existsSync('public'+x.src),x.src);assert.equal(readFileSync('public'+x.src).toString('ascii',8,12),'WEBP');}
});
test('retail discovery respects hierarchy and search; supplied merchant media takes precedence',()=>{
 assert.equal(matchingLeafImages({category:'fruit'}).length,5);
 assert.equal(matchingLeafImages({category:'fruit',leaf:'apple-pear'})[0].title,'사과 팩');
 assert.equal(matchingLeafImages({major:'household'}).length,3);
 assert.equal(matchingLeafImages({search:'사과'}).length,1);
 assert.equal(matchingLeafImages({search:'없는상품'}).length,0);
 const photo='/market-media/11111111-1111-4111-8111-111111111111.webp';
 assert.equal(displayImage(photo,'fruit','citrus'),photo);
 assert.equal(displayImage('https://untrusted.test/x.jpg','fruit','citrus'),leafImage('fruit','citrus'));
 assert(generatedImage(leafImage('fruit','citrus')));
});
