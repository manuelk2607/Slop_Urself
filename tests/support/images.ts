import { PNG } from 'pngjs';

export function testImage(width = 832, height = 624, noisy = false) {
    const image = new PNG({ width, height }); let seed = 17;
    for (let offset = 0; offset < image.data.length; offset += 4) {
        seed = Math.imul(seed, 1664525) + 1013904223;
        image.data[offset] = noisy ? seed >>> 24 : 200;
        image.data[offset + 1] = noisy ? seed >>> 16 : 80;
        image.data[offset + 2] = noisy ? seed >>> 8 : 110;
        image.data[offset + 3] = 255;
    }
    return PNG.sync.write(image);
}
export const testImageData = (width = 832, height = 624, noisy = false) => `data:image/png;base64,${testImage(width, height, noisy).toString('base64')}`;
