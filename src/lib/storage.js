// Small catalog images are compressed and stored with the product in Neon.
export async function uploadProductImage(file) {
 if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw new Error('僅支援 JPG、PNG、WebP、GIF 格式')
 if(file.size>5*1024*1024)throw new Error('圖片大小不可超過 5MB')
 const bitmap=await createImageBitmap(file)
 const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height))
 const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale)
 canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
 const image=canvas.toDataURL('image/webp',0.8)
 if(image.length>1400000)throw new Error('壓縮後仍超過 1MB，請選擇較小圖片')
 return image
}
export async function deleteProductImage() { /* Product update replaces the inline image atomically. */ }
