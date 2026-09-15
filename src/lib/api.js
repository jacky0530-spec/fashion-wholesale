export async function request(action, payload = {}) {
 try {
  const response=await fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})})
  const result=await response.json()
  if(!response.ok) throw new Error(result.error?.message || '服務暫時無法使用')
  return result
 } catch(error) {window.dispatchEvent(new CustomEvent('data-error',{detail:error.message}));return {data:null,error}}
}
