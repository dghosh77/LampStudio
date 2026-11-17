export const SERVICE='6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const RX='6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const TX='6e400003-b5a3-f393-e0a9-e50e24dcca9e';
// Stream adapter retains the USB transport's queue, handshake and STOP ordering.
export async function requestBluetoothPort(api=globalThis.navigator?.bluetooth){
 if(!api)throw new Error('Bluetooth requires desktop Chrome or Edge with Web Bluetooth. USB is also available.');
 const device=await api.requestDevice({filters:[{services:[SERVICE]}]});
 let receive,rx,tx,closed=false,listener;
 const port={
  async open(){
   const server=await device.gatt.connect();
   const service=await server.getPrimaryService(SERVICE);
   rx=await service.getCharacteristic(RX);tx=await service.getCharacteristic(TX);
   port.readable=new ReadableStream({start(c){receive=c;},cancel(){closed=true;}});
   listener=event=>{if(!closed){const v=event.target.value;receive.enqueue(new Uint8Array(v.buffer,v.byteOffset,v.byteLength).slice());}};
   tx.addEventListener('characteristicvaluechanged',listener);
   device.addEventListener('gattserverdisconnected',()=>{if(!closed){closed=true;receive.close();}},{once:true});
   await tx.startNotifications();
   port.writable=new WritableStream({async write(bytes){
    for(let i=0;i<bytes.length;i+=20)await rx.writeValueWithResponse(bytes.slice(i,i+20));
   }});
  },
  async close(){closed=true;tx?.removeEventListener('characteristicvaluechanged',listener);if(device.gatt.connected)device.gatt.disconnect();}
 };
 return port;
}
