import { chromium } from "playwright";
import fs from "node:fs/promises";

const SITE = "https://ime.doubao.com/pc";
const DEST = "status/doubao-windows.json";
const BASELINE = {version:"0.9.2", date:"2026-10-10", installer:"DoubaoIME_Installer_0.9.2.7_release.exe"};
const stamp = new Date().toISOString();
const versionOf = text => String(text||"").match(/(?:^|[^\d])v?(\d+\.\d+\.\d+)(?!\d)/i)?.[1]||null;
const dateOf = text => {
  const m=String(text||"").match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  return m ? [m[1],m[2].padStart(2,"0"),m[3].padStart(2,"0")].join("-") : null;
};
const filenameOf = value => {
  if(!value)return null;
  let s=String(value);
  try{s=decodeURIComponent(s);}catch{}
  return s.match(/DoubaoIME_Installer_[\d.]+(?:_[\w-]+)*\.exe/i)?.[0]
      ||s.match(/[^\/?&#"'\\\s]+\.exe(?:[?#]|$)/i)?.[0]?.split(/[?#]/)[0]
      ||null;
};
const cmp = (a,b) => {
  const x=(a||"").split(".").map(Number),y=(b||"").split(".").map(Number);
  for(let i=0;i<Math.max(x.length,y.length);i++){
    if((x[i]||0)!==(y[i]||0))return (x[i]||0)-(y[i]||0);
  }
  return 0;
};
await fs.mkdir("artifacts",{recursive:true});
let browser;
try{
  browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const context=await browser.newContext({locale:"zh-CN",timezoneId:"Asia/Shanghai",acceptDownloads:true});
  const page=await context.newPage();
  const requests=[];
  const responseFiles=[];
  page.on("request",r=>{
    if(/\.exe(?:[?#]|$)|DoubaoIME_Installer/i.test(r.url()))requests.push(r.url());
  });
  page.on("response",async r=>{
    try{
      const h=await r.headerValue("content-disposition");
      if(h&&/\.exe/i.test(h))responseFiles.push({url:r.url(),disposition:h});
    }catch{}
  });
  page.on("download",d=>{
    requests.push(d.url(),d.suggestedFilename());
    d.cancel().catch(()=>{});
  });
  await page.route("**/*",route=>{
    const url=route.request().url();
    if(/\.exe(?:[?#]|$)|DoubaoIME_Installer/i.test(url)){
      requests.push(url);
      return route.abort();
    }
    return route.continue();
  });
  const response=await page.goto(SITE,{waitUntil:"domcontentloaded",timeout:45000});
  if(!response || response.status()>=400)throw Error("Official site HTTP "+(response?.status()||"unknown"));
  await page.waitForTimeout(6000);

  // Find an isolated Windows card. A page-wide text match would mix Windows and macOS.
  async function findCard(){
    return page.evaluate(()=>{
      const nodes=[...document.querySelectorAll("body *")].filter(e=>{
        if(e.children.length>0)return false;
        const text=(e.textContent||"").trim();
        return /Windows\s*版/i.test(text) && text.length<140;
      });
      const options=[];
      for(const leaf of nodes){
        let el=leaf;
        for(let depth=0;el&&depth<9;depth++,el=el.parentElement){
          const txt=(el.innerText||"").trim();
          if(!/Windows\s*版/i.test(txt)||txt.length>1400)continue;
          if(/macOS\s*版/i.test(txt))continue;
          if(!(/立即下载/.test(txt)||/20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}/.test(txt)))continue;
          const anchors=[...el.querySelectorAll("a[href]")].map(x=>({
            text:(x.innerText||x.getAttribute("aria-label")||"").trim(),
            href:x.href
          }));
          const score=(/V?\d+\.\d+\.\d+/i.test(txt)?10:0)
            +(/20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}/.test(txt)?10:0)
            +(/立即下载/.test(txt)?4:0)-txt.length/500;
          options.push({text:txt,anchors,html:el.outerHTML.slice(0,28000),score,depth});
        }
      }
      return options.sort((a,b)=>b.score-a.score||a.depth-b.depth)[0]||null;
    });
  }
  let card=await findCard();
  if(!card || !versionOf(card.text) || !dateOf(card.text)){
    // Some website layouts show Windows details only after opening the download panel.
    const buttons=page.getByText("立即下载",{exact:true});
    const n=await buttons.count();
    for(let i=0;i<Math.min(n,3);i++){
      const b=buttons.nth(i);
      if(!(await b.isVisible().catch(()=>false)))continue;
      await b.click({timeout:5000,noWaitAfter:true}).catch(()=>{});
      await page.waitForTimeout(1600);
      const candidate=await findCard();
      if(candidate && versionOf(candidate.text) && dateOf(candidate.text)){
        card=candidate;break;
      }
    }
  }
  await page.screenshot({path:"artifacts/official-page.png",fullPage:true,timeout:18000}).catch(()=>{});
  if(!card)throw Error("Unable to isolate Windows-only download card");
  await fs.writeFile("artifacts/windows-card.json",JSON.stringify(card,null,2)+"\n");
  const version=versionOf(card.text);
  const date=dateOf(card.text);
  const links=card.anchors.filter(x=>/Windows|下载|\.exe/i.test(x.text+" "+x.href));
  let installer=links.map(x=>filenameOf(x.href)).find(Boolean)||null;
  let href=links.find(x=>filenameOf(x.href)===installer)?.href||null;
  if(!installer){
    // Click only inside the verified Windows card; never click a macOS/iOS download link.
    const win=page.getByText(/Windows\s*版/i).last();
    for(let depth=1;depth<=7 && !installer;depth++){
      const scope=win.locator("xpath="+Array(depth).fill("..").join("/"));
      const b=scope.getByText("立即下载",{exact:true}).first();
      if(!(await b.count()))continue;
      await b.click({timeout:4500,noWaitAfter:true}).catch(()=>{});
      await page.waitForTimeout(1300);
      installer=[...requests,...responseFiles.map(x=>x.disposition)].map(filenameOf).find(Boolean)||null;
    }
    href=[...requests,...responseFiles.map(x=>x.url),...links.map(x=>x.href)].find(x=>filenameOf(x)===installer)||href;
  }
  const evidence={platform:"Windows",version,date,installer,href,cardText:card.text,source:SITE,checkedAt:stamp};
  await fs.writeFile("artifacts/observation.json",JSON.stringify(evidence,null,2)+"\n");
  if(!version||!date||!installer){
    throw Error("Incomplete verified Windows evidence (do NOT assume unchanged): "+JSON.stringify({version,date,installer}));
  }
  const prior=JSON.parse(await fs.readFile(DEST,"utf8"));
  const history=Array.isArray(prior.history)?prior.history:[];
  const key=[version,date,installer].join("|");
  const firstSeen=!history.some(x=>x.key===key);
  if(firstSeen)history.push({key,version,date,installer,firstSeenAt:stamp});
  const candidate=cmp(version,BASELINE.version)>0||date!==BASELINE.date||installer!==BASELINE.installer;
  const result={
    platform:"Windows",source:SITE,baseline:BASELINE,
    latest:{version,date,installer,href},
    lastCheckedAt:stamp,verification:"complete_playwright_chromium",
    candidateChangeRelativeToBaseline:candidate,
    firstSeenThisRun:firstSeen,history:history.slice(-100)
  };
  await fs.writeFile(DEST,JSON.stringify(result,null,2)+"\n");
  console.log("VERIFIED_WINDOWS "+JSON.stringify({version,date,installer,candidate,firstSeen,checkedAt:stamp}));
}catch(error){
  console.error("WINDOWS_CHECK_INCOMPLETE; no new release conclusion: "+(error?.stack||error));
  process.exitCode=1;
}finally{
  await browser?.close().catch(()=>{});
}
