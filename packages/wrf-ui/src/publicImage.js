// Host-authenticated product images arrive as Blob URLs. Never add credentials.
export function loadPublicImage(url) {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 20000);
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = url;
  });
}
