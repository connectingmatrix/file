import { File } from './index.js'; const z=await File.zip([{path:'hello.txt', content:'hello'}]); console.log((await File.unzip(z))[0]);
