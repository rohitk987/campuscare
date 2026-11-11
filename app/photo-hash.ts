import {dHash,grayscale} from '@/lib/algorithms';

/** 64-bit perceptual fingerprint (dHash) of an image, video frame or canvas, drawn at 9 × 8 grey pixels. */
export function photoFingerprint(source:CanvasImageSource):string|null{
 try{
  const canvas=document.createElement('canvas');canvas.width=9;canvas.height=8;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return null;
  context.drawImage(source,0,0,9,8);
  return dHash(grayscale(context.getImageData(0,0,9,8).data,72));
 }catch{return null;}
}

/**
 * Fingerprint of the encoded file itself, decoded the way a reviewer's browser will decode it. Hashing the
 * canvas before JPEG compression lets compression noise flip bits on plain, low-texture photos, which then
 * look "changed" when the reviewer's browser re-hashes the stored file.
 */
export async function fileFingerprint(file:Blob):Promise<string|null>{
 try{
  if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(file);try{return photoFingerprint(bitmap);}finally{bitmap.close();}}
  const url=URL.createObjectURL(file);
  try{const img=new Image();img.src=url;await img.decode();return photoFingerprint(img);}finally{URL.revokeObjectURL(url);}
 }catch{return null;}
}
