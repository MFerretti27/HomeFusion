import sharp from 'sharp';

const input = new URL('../assets/homefusion.svg', import.meta.url);
const output = new URL('../assets/homefusion.png', import.meta.url);
await sharp(input.pathname).png().toFile(output.pathname);
console.log('Rendered assets/homefusion.png (1280 × 720).');