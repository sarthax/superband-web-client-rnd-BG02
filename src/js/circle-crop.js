/**
 * Interactive circular cropper for a round 240x240 badge.
 *
 * The user moves the photo under a fixed circular crop with mouse/touch.
 * Zoom slider, wheel zoom and two-finger pinch use the same bounded geometry.
 * The export uses the exact crop state shown in the preview.
 */
export const CROP_PREVIEW_SIZE = 320;
export const BG02_OUTPUT_SIZE = 240;

export function cropGeometry(imageWidth,imageHeight,zoom=1,offsetX=0,offsetY=0,size=CROP_PREVIEW_SIZE) {
  if (!imageWidth || !imageHeight) throw new Error('Invalid source image dimensions');
  const factor = Math.max(1,Math.min(4,Number(zoom)||1));
  const scale = Math.max(size/imageWidth,size/imageHeight)*factor;
  const drawWidth=imageWidth*scale, drawHeight=imageHeight*scale;
  const limitX=Math.max(0,(drawWidth-size)/2);
  const limitY=Math.max(0,(drawHeight-size)/2);
  const x=Math.max(-limitX,Math.min(limitX,offsetX));
  const y=Math.max(-limitY,Math.min(limitY,offsetY));
  return {
    scale, drawWidth, drawHeight,
    offsetX:x, offsetY:y,
    drawX:(size-drawWidth)/2+x,
    drawY:(size-drawHeight)/2+y,
    zoom:factor,
  };
}

export class CircleCropEditor {
  constructor({canvas,zoomInput,resetButton,onChange=()=>{}}) {
    this.canvas=canvas;
    this.zoomInput=zoomInput;
    this.resetButton=resetButton;
    this.onChange=onChange;
    this.image=null;
    this.zoom=1;
    this.offsetX=0;
    this.offsetY=0;
    this.pointers=new Map();
    this.lastPinchDistance=null;
    this.canvas.width=CROP_PREVIEW_SIZE;
    this.canvas.height=CROP_PREVIEW_SIZE;

    this.zoomInput.addEventListener('input',()=>{
      this.zoom=Number(this.zoomInput.value)/100;
      this.render();
    });
    this.resetButton.addEventListener('click',()=>this.reset());
    canvas.addEventListener('pointerdown',event=>this.pointerDown(event));
    canvas.addEventListener('pointermove',event=>this.pointerMove(event));
    for(const name of ['pointerup','pointercancel','lostpointercapture']) {
      canvas.addEventListener(name,event=>this.pointerEnd(event));
    }
    canvas.addEventListener('wheel',event=>{
      if(!this.image)return;
      event.preventDefault();
      this.zoom=Math.max(1,Math.min(4,this.zoom*(event.deltaY<0?1.12:1/1.12)));
      this.zoomInput.value=String(Math.round(this.zoom*100));
      this.render();
    },{passive:false});
  }

  setImage(image) {
    if(!image?.naturalWidth && !image?.width)throw new Error('Photo could not be decoded');
    this.image=image;
    this.reset();
  }

  clear() {
    this.image=null;
    this.pointers.clear();
    this.lastPinchDistance=null;
    this.canvas.getContext('2d').clearRect(0,0,this.canvas.width,this.canvas.height);
  }

  reset() {
    this.zoom=1;this.offsetX=0;this.offsetY=0;
    this.zoomInput.value='100';
    this.render();
  }

  geometry() {
    if(!this.image)throw new Error('Choose a photo first');
    return cropGeometry(
      this.image.naturalWidth||this.image.width,
      this.image.naturalHeight||this.image.height,
      this.zoom,this.offsetX,this.offsetY,
    );
  }

  render() {
    if(!this.image)return;
    const g=this.geometry();
    this.offsetX=g.offsetX;
    this.offsetY=g.offsetY;
    const ctx=this.canvas.getContext('2d');
    this.paint(ctx,CROP_PREVIEW_SIZE);
    this.onChange({zoom:Math.round(this.zoom*100)});
  }

  paint(ctx,size) {
    const g=this.geometry(),mul=size/CROP_PREVIEW_SIZE;
    ctx.save();
    ctx.clearRect(0,0,size,size);
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,size,size);
    ctx.beginPath();
    ctx.arc(size/2,size/2,size/2,0,Math.PI*2);
    ctx.clip();
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(
      this.image,
      g.drawX*mul,g.drawY*mul,g.drawWidth*mul,g.drawHeight*mul,
    );
    ctx.restore();
  }

  getImageData(size=BG02_OUTPUT_SIZE) {
    if(!this.image)throw new Error('No photo is loaded');
    const canvas=document.createElement('canvas');
    canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    this.paint(ctx,size);
    return ctx.getImageData(0,0,size,size);
  }

  pointerCoords(event) {
    const box=this.canvas.getBoundingClientRect();
    return {
      x:(event.clientX-box.left)*CROP_PREVIEW_SIZE/box.width,
      y:(event.clientY-box.top)*CROP_PREVIEW_SIZE/box.height,
    };
  }

  pointerDown(event) {
    if(!this.image)return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId,this.pointerCoords(event));
    this.lastPinchDistance=this.pointers.size===2?this.pointerDistance():null;
  }

  pointerDistance() {
    const [a,b]=[...this.pointers.values()];
    return a && b?Math.hypot(a.x-b.x,a.y-b.y):null;
  }

  pointerMove(event) {
    if(!this.image||!this.pointers.has(event.pointerId))return;
    event.preventDefault();
    const next=this.pointerCoords(event);
    const previous=this.pointers.get(event.pointerId);
    this.pointers.set(event.pointerId,next);
    if(this.pointers.size>=2) {
      const distance=this.pointerDistance();
      if(this.lastPinchDistance && distance) {
        this.zoom=Math.max(1,Math.min(4,this.zoom*distance/this.lastPinchDistance));
        this.zoomInput.value=String(Math.round(this.zoom*100));
      }
      this.lastPinchDistance=distance;
    }else{
      this.offsetX+=next.x-previous.x;
      this.offsetY+=next.y-previous.y;
    }
    this.render();
  }

  pointerEnd(event) {
    this.pointers.delete(event.pointerId);
    if(this.pointers.size<2)this.lastPinchDistance=null;
  }
}
