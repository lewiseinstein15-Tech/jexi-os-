var wt=Object.defineProperty;var rt=Object.getOwnPropertySymbols;var Ct=Object.prototype.hasOwnProperty,Dt=Object.prototype.propertyIsEnumerable;var st=(t,e,n)=>e in t?wt(t,e,{enumerable:!0,configurable:!0,writable:!0,value:n}):t[e]=n,U=(t,e)=>{for(var n in e||(e={}))Ct.call(e,n)&&st(t,n,e[n]);if(rt)for(var n of rt(e))Dt.call(e,n)&&st(t,n,e[n]);return t};import{p as vt}from"./chunk-JWPE2WC7-AgL9s0ji.js";import{s as kt,g as At,o as Tt,n as Bt,a as St,b as Mt,_ as s,l as X,D as zt,e as Lt,p as Nt,A as Z,y as J,B as Pt,E as ct}from"./mermaid.core-BJJQOL44.js";import{p as It}from"./cynefin-VYW2F7L2-CiTWqNti.js";import"./index-BOcJ5oi2.js";var lt=s(()=>({domains:new Map,transitions:[]}),"createDefaultData"),H=lt(),Wt=s(()=>H.domains,"getDomains"),Rt=s(()=>H.transitions,"getTransitions"),_t=s(t=>{var e;if(t)for(const n of t){const a=n.domain,c=((e=n.items)!=null?e:[]).map(f=>({label:f.label}));H.domains.set(a,{name:a,items:c})}},"setDomains"),Et=s(t=>{t&&(H.transitions=t.filter(e=>e.from===e.to?(X.warn(`Cynefin: self-loop transition on domain "${e.from}" is not meaningful and will be skipped.`),!1):!0).map(e=>({from:e.from,to:e.to,label:e.label||void 0})))},"setTransitions"),Ft=s(()=>Z(U(U({},Pt.cynefin),J().cynefin)),"getConfig"),Vt=s(()=>{Nt(),H=lt()},"clear"),Y={getDomains:Wt,getTransitions:Rt,setDomains:_t,setTransitions:Et,getConfig:Ft,clear:Vt,setAccTitle:Mt,getAccTitle:St,setDiagramTitle:Bt,getDiagramTitle:Tt,getAccDescription:At,setAccDescription:kt},Ht=s(t=>{vt(t,Y),Y.setDomains(t.domains),Y.setTransitions(t.transitions)},"populate"),Gt={parse:s(async t=>{const e=await It("cynefin",t);X.debug(e),Ht(e)},"parse")};function V(t){let e=t+1831565813|0;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}s(V,"seededRandom");function ft(t){let e=0;for(let n=0;n<t.length;n++){const a=t.charCodeAt(n);e=(e<<5)-e+a,e|=0}return e}s(ft,"hashString");function dt(t,e){return typeof t=="number"&&Number.isFinite(t)&&t!==0?t:ft(e)}s(dt,"resolveSeed");function mt(t,e,n,a){const c=t/2,f=a!=null?a:t*.015,D=7,W=e/D,d=[];for(let o=0;o<=D;o++){const p=V(n+o*17)*f*2-f;d.push({x:c+p,y:o*W})}let v=`M${d[0].x},${d[0].y}`;for(let o=0;o<d.length-1;o++){const p=d[o],i=d[o+1],m=(p.y+i.y)/2,b=o%2===0?1:-1,h=f*1.5*b*V(n+o*31+7),R=p.x+h,_=m,E=i.x-h;v+=` C${R},${_} ${E},${m} ${i.x},${i.y}`}return v}s(mt,"generateFoldPath");function pt(t,e,n,a){const c=e/2,f=a!=null?a:e*.015,D=7,W=t/D,d=[];for(let o=0;o<=D;o++){const p=V(n+o*23)*f*2-f;d.push({x:o*W,y:c+p})}let v=`M${d[0].x},${d[0].y}`;for(let o=0;o<d.length-1;o++){const p=d[o],i=d[o+1],m=(p.x+i.x)/2,b=o%2===0?1:-1,h=f*1.5*b*V(n+o*37+11),R=m,_=p.y+h,E=m,z=i.y-h;v+=` C${R},${_} ${E},${z} ${i.x},${i.y}`}return v}s(pt,"generateHorizontalBoundary");function yt(t,e){const n=t/2,a=e*.5,c=e,f=t*.03;return[`M${n},${a}`,`C${n+f},${a+(c-a)*.2}`,`${n-f*1.5},${a+(c-a)*.55}`,`${n+f*.5},${a+(c-a)*.75}`,`C${n-f},${a+(c-a)*.85}`,`${n+f*.3},${a+(c-a)*.95}`,`${n},${c}`].join(" ")}s(yt,"generateCliffPath");function ut(t,e,n,a){return[`M${t-n},${e}`,`A${n},${a} 0 1,1 ${t+n},${e}`,`A${n},${a} 0 1,1 ${t-n},${e}`,"Z"].join(" ")}s(ut,"generateConfusionPath");var it={complex:{model:"Probe → Sense → Respond",practice:"Emergent Practices"},complicated:{model:"Sense → Analyse → Respond",practice:"Good Practices"},clear:{model:"Sense → Categorise → Respond",practice:"Best Practices"},chaotic:{model:"Act → Sense → Respond",practice:"Novel Practices"},confusion:{model:"",practice:"Disorder"}},Yt=s((t,e)=>{const n=t/2,a=e/2;return{complex:{cx:n/2,cy:a/2,x:0,y:0,w:n,h:a},complicated:{cx:n+n/2,cy:a/2,x:n,y:0,w:n,h:a},chaotic:{cx:n/2,cy:a+a/2,x:0,y:a,w:n,h:a},clear:{cx:n+n/2,cy:a+a/2,x:n,y:a,w:n,h:a},confusion:{cx:n,cy:a,x:n*.7,y:a*.7,w:n*.6,h:a*.6}}},"getDomainLayouts"),Xt=s(()=>{const t=ct(),e=J();return Z(t,e.themeVariables).cynefin},"getCynefinDomainColors"),Q=3,jt=s((t,e,n,a)=>{var nt;const c=a.db,f=c.getDomains(),D=c.getTransitions(),W=c.getDiagramTitle(),d=c.getAccTitle(),v=c.getAccDescription(),o=c.getConfig(),p=Xt();X.debug("Rendering Cynefin diagram");const i=o.width,m=o.height,b=o.padding,h=o.showDomainDescriptions,R=o.boundaryAmplitude,_=i+b*2,E=m+b*2,z={complex:p.complexBg,complicated:p.complicatedBg,clear:p.clearBg,chaotic:p.chaoticBg,confusion:p.confusionBg},k=zt(e);Lt(k,E,_,(nt=o.useMaxWidth)!=null?nt:!0),k.attr("viewBox",`0 0 ${_} ${E}`),d&&k.append("title").text(d),v&&k.append("desc").text(v);const A=k.append("g").attr("transform",`translate(${b}, ${b})`),F=Yt(i,m),K=dt(o.seed,e),ht=A.append("g").attr("class","cynefin-backgrounds"),j=["complex","complicated","chaotic","clear"];for(const l of j){const r=F[l];ht.append("rect").attr("class","cynefinDomain").attr("x",r.x).attr("y",r.y).attr("width",r.w).attr("height",r.h).attr("fill",z[l]).attr("fill-opacity",.4).attr("stroke","none")}const q=A.append("g").attr("class","cynefin-boundaries");q.append("path").attr("class","cynefinBoundary").attr("d",mt(i,m,K,R)).attr("fill","none"),q.append("path").attr("class","cynefinBoundary").attr("d",pt(i,m,K+100,R)).attr("fill","none"),q.append("path").attr("class","cynefinCliff").attr("d",yt(i,m)).attr("fill","none");const xt=i*.15,gt=m*.15;A.append("path").attr("class","cynefinConfusion").attr("d",ut(i/2,m/2,xt,gt)).attr("fill",z.confusion).attr("fill-opacity",.5);const O=A.append("g").attr("class","cynefin-labels");for(const l of j){const r=F[l];O.append("text").attr("class","cynefinDomainLabel").attr("x",r.cx).attr("y",h?r.cy-30:r.cy).attr("text-anchor","middle").attr("dominant-baseline","middle").text(l.charAt(0).toUpperCase()+l.slice(1))}if(O.append("text").attr("class","cynefinDomainLabel").attr("x",i/2).attr("y",h?m/2-10:m/2).attr("text-anchor","middle").attr("dominant-baseline","middle").text("Confusion"),h){const l=A.append("g").attr("class","cynefin-subtitles");for(const r of j){const u=F[r],y=it[r];l.append("text").attr("class","cynefinSubtitle").attr("x",u.cx).attr("y",u.cy-10).attr("text-anchor","middle").attr("dominant-baseline","middle").text(y.model),l.append("text").attr("class","cynefinSubtitle").attr("x",u.cx).attr("y",u.cy+5).attr("text-anchor","middle").attr("dominant-baseline","middle").text(y.practice)}l.append("text").attr("class","cynefinSubtitle").attr("x",i/2).attr("y",m/2+8).attr("text-anchor","middle").attr("dominant-baseline","middle").text(it.confusion.practice)}const tt=A.append("g").attr("class","cynefin-items"),T=26,et=10,$t=["complex","complicated","chaotic","clear","confusion"];for(const l of $t){const r=f.get(l);if(!r||r.items.length===0)continue;const u=F[l],y=l==="confusion";let L=r.items,N=0;y&&r.items.length>Q&&(N=r.items.length-Q,L=r.items.slice(0,Q));let B;if(y){const g=h?22:14;B=u.cy+g}else B=u.cy+(h?25:15);if([...L].forEach((g,S)=>{const w=B+S*(T+4),M=tt.append("g"),P=M.append("text").attr("class","cynefinItemText").attr("x",0).attr("y",T/2).attr("text-anchor","middle").attr("dominant-baseline","central").text(g.label);let $=g.label.length*7;const x=P.node();if(x&&typeof x.getBBox=="function"){const G=x.getBBox();G.width>0&&($=G.width)}const C=$+et*2,I=u.cx-C/2;M.attr("transform",`translate(${I}, ${w})`),M.insert("rect","text").attr("class","cynefinItem").attr("x",0).attr("y",0).attr("width",C).attr("height",T).attr("rx",4).attr("ry",4).attr("fill",z[l]).attr("fill-opacity",.95),P.attr("x",C/2).attr("y",T/2)}),N>0){const g=B+L.length*(T+4),S=`+${N} more`,w=tt.append("g"),M=w.append("text").attr("class","cynefinItemText").attr("x",0).attr("y",T/2).attr("text-anchor","middle").attr("dominant-baseline","central").text(S);let P=S.length*7;const $=M.node();if($&&typeof $.getBBox=="function"){const I=$.getBBox();I.width>0&&(P=I.width)}const x=P+et*2,C=u.cx-x/2;w.attr("transform",`translate(${C}, ${g})`),w.insert("rect","text").attr("class","cynefinItemOverflow").attr("x",0).attr("y",0).attr("width",x).attr("height",T).attr("rx",4).attr("ry",4).attr("fill",z[l]).attr("fill-opacity",.6),M.attr("x",x/2).attr("y",T/2)}}if(D.length>0){const l=k.select("defs").empty()?k.append("defs"):k.select("defs"),r=`cynefin-arrow-${e}`;l.append("marker").attr("id",r).attr("viewBox","0 0 10 10").attr("refX",9).attr("refY",5).attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto-start-reverse").append("path").attr("d","M 0 0 L 10 5 L 0 10 z").attr("class","cynefinArrowHead");const u=A.append("g").attr("class","cynefin-arrows");D.forEach(y=>{const L=F[y.from],N=F[y.to];if(!L||!N)return;if(y.from===y.to){X.warn(`Cynefin renderer: skipping self-loop on domain "${y.from}"`);return}const B=L.cx,g=L.cy,S=N.cx,w=N.cy,M=(B+S)/2,P=(g+w)/2,$=S-B,x=w-g,C=Math.sqrt($*$+x*x),I=C*.15,G=-x/C,bt=$/C,at=M+G*I,ot=P+bt*I;u.append("path").attr("class","cynefinArrowLine").attr("d",`M${B},${g} Q${at},${ot} ${S},${w}`).attr("fill","none").attr("marker-end",`url(#${r})`),y.label&&u.append("text").attr("class","cynefinArrowLabel").attr("x",at).attr("y",ot-6).attr("text-anchor","middle").attr("dominant-baseline","auto").text(y.label)})}W&&A.append("text").attr("class","cynefinTitle").attr("x",i/2).attr("y",-b/2).attr("text-anchor","middle").attr("dominant-baseline","middle").text(W)},"draw"),qt={draw:jt},Ut=s(()=>{const t=ct(),e=J();return Z(t,e.themeVariables).cynefin},"getCynefinTheme"),Qt=s(()=>{const t=Ut();return`
	.cynefinDomain {
		stroke: none;
	}
	.cynefinDomainLabel {
		font-size: ${t.domainFontSize}px;
		font-weight: bold;
		fill: ${t.labelColor};
	}
	.cynefinSubtitle {
		font-size: ${t.itemFontSize-1}px;
		fill: ${t.textColor};
		font-style: italic;
	}
	.cynefinItem {
		fill-opacity: 0.95;
		stroke: ${t.boundaryColor};
		stroke-width: 1;
	}
	.cynefinItemText {
		font-size: ${t.itemFontSize}px;
		fill: ${t.textColor};
	}
	.cynefinItemOverflow {
		fill-opacity: 0.6;
		stroke: ${t.boundaryColor};
		stroke-width: 1;
		stroke-dasharray: 3 2;
	}
	.cynefinBoundary {
		stroke: ${t.boundaryColor};
		stroke-width: ${t.boundaryWidth};
		stroke-dasharray: 6 3;
	}
	.cynefinCliff {
		stroke: ${t.cliffColor};
		stroke-width: ${t.cliffWidth};
	}
	.cynefinConfusion {
		stroke: ${t.boundaryColor};
		stroke-width: 1.5;
		stroke-dasharray: 4 2;
	}
	.cynefinArrowLine {
		stroke: ${t.arrowColor};
		stroke-width: ${t.arrowWidth};
		fill: none;
	}
	.cynefinArrowHead {
		fill: ${t.arrowColor};
		stroke: none;
	}
	.cynefinArrowLabel {
		font-size: ${t.itemFontSize-1}px;
		fill: ${t.textColor};
	}
	.cynefinTitle {
		font-size: ${t.domainFontSize+2}px;
		font-weight: bold;
		fill: ${t.labelColor};
	}
	`},"styles"),Zt=Qt,ne={parser:Gt,db:Y,renderer:qt,styles:Zt};export{ne as diagram};
