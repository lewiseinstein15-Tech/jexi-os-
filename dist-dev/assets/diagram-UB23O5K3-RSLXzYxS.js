var D=Object.defineProperty;var A=Object.getOwnPropertySymbols;var F=Object.prototype.hasOwnProperty,P=Object.prototype.propertyIsEnumerable;var M=(a,t,e)=>t in a?D(a,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):a[t]=e,C=(a,t)=>{for(var e in t||(t={}))F.call(t,e)&&M(a,e,t[e]);if(A)for(var e of A(t))P.call(t,e)&&M(a,e,t[e]);return a};import{p as z}from"./chunk-JWPE2WC7-AgL9s0ji.js";import{s as G,g as B,o as W,n as V,a as H,b as j,_ as c,D as U,p as X,A as b,y as L,B as K,l as T,E as N,e as Y}from"./mermaid.core-BJJQOL44.js";import{p as Z}from"./cynefin-VYW2F7L2-CiTWqNti.js";import"./index-BOcJ5oi2.js";var h={showLegend:!0,ticks:5,max:null,min:0,graticule:"circle"},y=32,S={axes:[],curves:[],options:h},m=structuredClone(S),q=K.radar,J=c(()=>b(C(C({},q),L().radar)),"getConfig"),k=c(()=>m.axes,"getAxes"),Q=c(()=>m.curves,"getCurves"),tt=c(()=>m.options,"getOptions"),et=c(a=>{m.axes=a.map(t=>{var e;return{name:t.name,label:(e=t.label)!=null?e:t.name}})},"setAxes"),at=c(a=>{m.curves=a.map(t=>{var e;return{name:t.name,label:(e=t.label)!=null?e:t.name,entries:rt(t.entries)}})},"setCurves"),rt=c(a=>{if(a[0].axis==null)return a.map(e=>e.value);const t=k();if(t.length===0)throw new Error("Axes must be populated before curves for reference entries");return t.map(e=>{const r=a.find(s=>{var n;return((n=s.axis)==null?void 0:n.$refText)===e.name});if(r===void 0)throw new Error("Missing entry for axis "+e.label);return r.value})},"computeCurveEntries"),st=c(a=>{var e,r,s,n,l,o,i,d,p,u;const t=a.reduce((g,x)=>(g[x.name]=x,g),{});m.options={showLegend:(r=(e=t.showLegend)==null?void 0:e.value)!=null?r:h.showLegend,ticks:(n=(s=t.ticks)==null?void 0:s.value)!=null?n:h.ticks,max:(o=(l=t.max)==null?void 0:l.value)!=null?o:h.max,min:(d=(i=t.min)==null?void 0:i.value)!=null?d:h.min,graticule:(u=(p=t.graticule)==null?void 0:p.value)!=null?u:h.graticule},m.options.ticks>y&&(T.warn(`Radar diagram ticks (${m.options.ticks}) exceeds maximum allowed (${y}). Using ${y} instead.`),m.options.ticks=y)},"setOptions"),nt=c(()=>{X(),m=structuredClone(S)},"clear"),f={getAxes:k,getCurves:Q,getOptions:tt,setAxes:et,setCurves:at,setOptions:st,getConfig:J,clear:nt,setAccTitle:j,getAccTitle:H,setDiagramTitle:V,getDiagramTitle:W,getAccDescription:B,setAccDescription:G},ot=c(a=>{z(a,f);const{axes:t,curves:e,options:r}=a;f.setAxes(t),f.setCurves(e),f.setOptions(r)},"populate"),it={parse:c(async a=>{const t=await Z("radar",a);T.debug(t),ot(t)},"parse")},lt=c((a,t,e,r)=>{var $;const s=r.db,n=s.getAxes(),l=s.getCurves(),o=s.getOptions(),i=s.getConfig(),d=s.getDiagramTitle(),p=U(t),u=ct(p,i),g=($=o.max)!=null?$:Math.max(...l.map(w=>Math.max(...w.entries))),x=o.min,v=Math.min(i.width,i.height)/2;dt(u,n,v,o.ticks,o.graticule),ut(u,n,v,i),O(u,n,l,x,g,o.graticule,i),_(u,l,o.showLegend,i),u.append("text").attr("class","radarTitle").text(d).attr("x",0).attr("y",-i.height/2-i.marginTop)},"draw"),ct=c((a,t)=>{var n;const e=t.width+t.marginLeft+t.marginRight,r=t.height+t.marginTop+t.marginBottom,s={x:t.marginLeft+t.width/2,y:t.marginTop+t.height/2};return Y(a,r,e,(n=t.useMaxWidth)!=null?n:!0),a.attr("viewBox",`0 0 ${e} ${r}`).attr("overflow","visible"),a.append("g").attr("transform",`translate(${s.x}, ${s.y})`)},"drawFrame"),dt=c((a,t,e,r,s)=>{if(s==="circle")for(let n=0;n<r;n++){const l=e*(n+1)/r;a.append("circle").attr("r",l).attr("class","radarGraticule")}else if(s==="polygon"){const n=t.length;for(let l=0;l<r;l++){const o=e*(l+1)/r,i=t.map((d,p)=>{const u=2*p*Math.PI/n-Math.PI/2,g=o*Math.cos(u),x=o*Math.sin(u);return`${g},${x}`}).join(" ");a.append("polygon").attr("points",i).attr("class","radarGraticule")}}},"drawGraticule"),ut=c((a,t,e,r)=>{const s=t.length;for(let n=0;n<s;n++){const l=t[n].label,o=2*n*Math.PI/s-Math.PI/2,i=Math.cos(o),d=Math.sin(o);a.append("line").attr("x1",0).attr("y1",0).attr("x2",e*r.axisScaleFactor*i).attr("y2",e*r.axisScaleFactor*d).attr("class","radarAxisLine");const p=i>.01?"start":i<-.01?"end":"middle",u=d>.01?"hanging":d<-.01?"auto":"central",g=4;a.append("text").text(l).attr("x",e*r.axisLabelFactor*i+g*i).attr("y",e*r.axisLabelFactor*d+g*d).attr("text-anchor",p).attr("dominant-baseline",u).attr("class","radarAxisLabel")}},"drawAxes");function O(a,t,e,r,s,n,l){const o=t.length,i=Math.min(l.width,l.height)/2;e.forEach((d,p)=>{if(d.entries.length!==o)return;const u=d.entries.map((g,x)=>{const v=2*Math.PI*x/o-Math.PI/2,$=R(g,r,s,i),w=$*Math.cos(v),E=$*Math.sin(v);return{x:w,y:E}});n==="circle"?a.append("path").attr("d",I(u,l.curveTension)).attr("class",`radarCurve-${p}`):n==="polygon"&&a.append("polygon").attr("points",u.map(g=>`${g.x},${g.y}`).join(" ")).attr("class",`radarCurve-${p}`)})}c(O,"drawCurves");function R(a,t,e,r){const s=Math.min(Math.max(a,t),e);return r*(s-t)/(e-t)}c(R,"relativeRadius");function I(a,t){const e=a.length;let r=`M${a[0].x},${a[0].y}`;for(let s=0;s<e;s++){const n=a[(s-1+e)%e],l=a[s],o=a[(s+1)%e],i=a[(s+2)%e],d={x:l.x+(o.x-n.x)*t,y:l.y+(o.y-n.y)*t},p={x:o.x-(i.x-l.x)*t,y:o.y-(i.y-l.y)*t};r+=` C${d.x},${d.y} ${p.x},${p.y} ${o.x},${o.y}`}return`${r} Z`}c(I,"closedRoundCurve");function _(a,t,e,r){if(!e)return;const s=(r.width/2+r.marginRight)*3/4,n=-(r.height/2+r.marginTop)*3/4,l=20;t.forEach((o,i)=>{const d=a.append("g").attr("transform",`translate(${s}, ${n+i*l})`);d.append("rect").attr("width",12).attr("height",12).attr("class",`radarLegendBox-${i}`),d.append("text").attr("x",16).attr("y",0).attr("class","radarLegendText").text(o.label)})}c(_,"drawLegend");var pt={draw:lt},gt=c((a,t)=>{let e="";for(let r=0;r<a.THEME_COLOR_LIMIT;r++){const s=a[`cScale${r}`];e+=`
		.radarCurve-${r} {
			color: ${s};
			fill: ${s};
			fill-opacity: ${t.curveOpacity};
			stroke: ${s};
			stroke-width: ${t.curveStrokeWidth};
		}
		.radarLegendBox-${r} {
			fill: ${s};
			fill-opacity: ${t.curveOpacity};
			stroke: ${s};
		}
		`}return e},"genIndexStyles"),mt=c(a=>{const t=N(),e=L(),r=b(t,e.themeVariables),s=b(r.radar,a);return{themeVariables:r,radarOptions:s}},"buildRadarStyleOptions"),xt=c(({radar:a}={})=>{const{themeVariables:t,radarOptions:e}=mt(a);return`
	.radarTitle {
		font-size: ${t.fontSize};
		color: ${t.titleColor};
		dominant-baseline: hanging;
		text-anchor: middle;
	}
	.radarAxisLine {
		stroke: ${e.axisColor};
		stroke-width: ${e.axisStrokeWidth};
	}
	.radarAxisLabel {
		font-size: ${e.axisLabelFontSize}px;
		color: ${e.axisColor};
	}
	.radarGraticule {
		fill: ${e.graticuleColor};
		fill-opacity: ${e.graticuleOpacity};
		stroke: ${e.graticuleColor};
		stroke-width: ${e.graticuleStrokeWidth};
	}
	.radarLegendText {
		text-anchor: start;
		font-size: ${e.legendFontSize}px;
		dominant-baseline: hanging;
	}
	${gt(t,e)}
	`},"styles"),wt={parser:it,db:f,renderer:pt,styles:xt};export{wt as diagram};
