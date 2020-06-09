const Jimp = require('jimp');
const EventEmitter = require('events');
class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

let isReady = false;
Module = {
    onRuntimeInitialized() {
        init();
    }
  }
const cv = require('./opencv.js');


function init() {
    isReady = true;
    myEmitter.emit('ready');
}

function isReadyFunc () {
    return new Promise((reslove,reject)=>{
        if(isReady){return reslove(isReady)}
        myEmitter.once('ready',()=>{
            return reslove(isReady)
        });
        setTimeout(()=>{
            return reject(new Error('loading opencv time out'))
        },3*1000)
    })
}

function shiftDFT(mag) {
    let rect = new cv.Rect(0, 0, mag.cols & (-2), mag.rows & (-2));
    mag = mag.roi(rect);

    let cx = mag.cols / 2;
    let cy = mag.rows / 2;

    let q0 = mag.roi(new cv.Rect(0, 0, cx, cy));
    let q1 = mag.roi(new cv.Rect(cx, 0, cx, cy));
    let q2 = mag.roi(new cv.Rect(0, cy, cx, cy));
    let q3 = mag.roi(new cv.Rect(cx, cy, cx, cy));

    let tmp =  new cv.Mat();
    q0.copyTo(tmp);
    q3.copyTo(q0);
    tmp.copyTo(q3);

    q1.copyTo(tmp);
    q2.copyTo(q1);
    tmp.copyTo(q2);
}

function getBlueChannel(image)
{
    let nextImg = image;
    let channel = new cv.MatVector();
    cv.split(nextImg, channel);
    return channel.get(0);
}

function getDftMat(padded)
{
    let planes = new cv.MatVector();
    planes.push_back(padded);
    planes.push_back(new cv.Mat.zeros(padded.size(), cv.CV_32F));
    let comImg = new cv.Mat();
    cv.merge(planes,comImg);
    cv.dft(comImg, comImg);
    return comImg;
}

function addTextByMat(comImg,watermarkText,point,fontSize)
{
    cv.putText(comImg, watermarkText, point, cv.FONT_HERSHEY_DUPLEX, fontSize, cv.Scalar.all(0),2);  
    cv.flip(comImg, comImg, -1);
    cv.putText(comImg, watermarkText, point, cv.FONT_HERSHEY_DUPLEX, fontSize, cv.Scalar.all(0),2);  
    cv.flip(comImg, comImg, -1);
}

cv.idft = function(src, dst, flags, nonzero_rows ) {
  cv.dft( src, dst, flags | cv.DFT_INVERSE, nonzero_rows );
}

function transFormMatWithText(srcImg, watermarkText,fontSize) {
    let padded = getBlueChannel(srcImg);
    padded.convertTo(padded, cv.CV_32F);
    let comImg = getDftMat(padded);
    // add text 
    let center = new cv.Point(padded.cols/2, padded.rows/2);
    addTextByMat(comImg,watermarkText,center,fontSize);
    let outer = new cv.Point (45, 45);
    addTextByMat(comImg,watermarkText,outer,fontSize);
    //back image
    let invDFT = new cv.Mat();
    cv.idft(comImg, invDFT, cv.DFT_SCALE | cv.DFT_REAL_OUTPUT, 0);
    let restoredImage = new cv.Mat();
    invDFT.convertTo(restoredImage, cv.CV_8U);
    let backPlanes = new cv.MatVector();
    cv.split(srcImg, backPlanes);
    // backPlanes.erase(backPlanes.get(0));
    // backPlanes.insert(backPlanes.get(0), restoredImage);
    backPlanes.set(0,restoredImage)
    let backImage = new cv.Mat();
    cv.merge(backPlanes,backImage);
    return backImage;
}

function getTextFormMat(backImage) {
    let padded= getBlueChannel(backImage);
    padded.convertTo(padded, cv.CV_32F);
    let comImg = getDftMat(padded);
    let backPlanes = new cv.MatVector();
    // split the comples image in two backPlanes  
    cv.split(comImg, backPlanes);
    let mag = new cv.Mat();
    // compute the magnitude
    cv.magnitude(backPlanes.get(0), backPlanes.get(1), mag);
    // move to a logarithmic scale  
    cv.add(cv.Mat.ones(mag.size(), cv.CV_32F), mag, mag);  
    cv.log(mag, mag);  
    shiftDFT(mag);
    mag.convertTo(mag, cv.CV_8UC1);
    cv.normalize(mag, mag, 0, 255, cv.NORM_MINMAX, cv.CV_8UC1);  
    return mag;    
}

function matToBuffer(mat){
    if(!(mat instanceof cv.Mat)){
        throw new Error("Please input the valid new cv.Mat instance.");
    }
    var img=new cv.Mat();
    var depth=mat.type()%8;
    var scale=depth<=cv.CV_8S?1:depth<=cv.CV_32S?1/256:255;
    var shift=depth===cv.CV_8S||depth===cv.CV_16S?128:0;
    mat.convertTo(img,cv.CV_8U,scale,shift);
    switch(img.type()){
        case cv.CV_8UC1:cv.cvtColor(img,img,cv.COLOR_GRAY2RGBA);break;
        case cv.CV_8UC3:cv.cvtColor(img,img,cv.COLOR_RGB2RGBA);break;
        case cv.CV_8UC4:break;
        default:throw new Error("Bad number of channels (Source image must have 1, 3 or 4 channels)");
    }
    var imgData=Buffer.from(img.data);
    img.delete()
    return imgData
}

async function transformImageWithText(srcFileName,watermarkText,fontSize,enCodeFileName='') {
  await isReadyFunc ()
  if((typeof srcFileName)!='string' && (!(srcFileName instanceof Buffer))) {
    throw new Error('fileName must be string or Buffer')
  }
  if((typeof watermarkText)!='string') {
    throw new Error('waterMarkText must be string')
  }
  if((typeof fontSize)!='number') {
    throw new Error('fontSize must be number')
  }
  if((typeof enCodeFileName)!='string') {
    throw new Error('outFileName must be string')
  }
  let jimpSrc = await Jimp.read(srcFileName);
  let srcImg = new cv.matFromImageData(jimpSrc.bitmap);
  if (srcImg.empty()){throw new Error("read image failed");}
  let comImg = transFormMatWithText(srcImg, watermarkText, fontSize);
  const imgRes = new Jimp({
    width: comImg.cols,
    height: comImg.rows,
    data: matToBuffer(comImg)
  });
  if(enCodeFileName) {
    return await imgRes.writeAsync(enCodeFileName);
  } else {
    return imgRes
  }
}

async function getTextFormImage(enCodeFileName,deCodeFileName='') {
    await isReadyFunc ()
    if((typeof enCodeFileName)!='string'  && (!(enCodeFileName instanceof Buffer))) {
      throw new Error('fileName must be string or Buffer')
    }
    if((typeof deCodeFileName)!='string') {
      throw new Error('backFileName must be string')
    }

    let jimpSrc = await Jimp.read(enCodeFileName);
    let comImg = new cv.matFromImageData(jimpSrc.bitmap);
    let backImage = getTextFormMat(comImg);
    const imgRes = await new Jimp({
        width: backImage.cols,
        height: backImage.rows,
        data: matToBuffer(backImage)
    })
    if(deCodeFileName) {
      return await imgRes.writeAsync(deCodeFileName);
    } else {
      return imgRes
    }
  }


module.exports.transformImageWithText = transformImageWithText;
module.exports.getTextFormImage = getTextFormImage;