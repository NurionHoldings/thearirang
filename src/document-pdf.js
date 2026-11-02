import html2canvas from 'html2canvas';
import {jsPDF} from 'jspdf';
export async function downloadPDF(pages,filename){
 const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
 for(let i=0;i<pages.length;i++){
  const canvas=await html2canvas(pages[i],{scale:2,backgroundColor:'#ffffff',useCORS:false,logging:false,windowWidth:Math.max(1200,innerWidth)});
  if(i)pdf.addPage();pdf.addImage(canvas.toDataURL('image/jpeg',.94),'JPEG',0,0,210,297,undefined,'FAST');canvas.width=canvas.height=1;
 }
 pdf.save(filename+'.pdf');
}
