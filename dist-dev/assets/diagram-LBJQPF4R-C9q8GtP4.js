var D=Object.defineProperty;var w=Object.getOwnPropertySymbols;var T=Object.prototype.hasOwnProperty,P=Object.prototype.propertyIsEnumerable;var v=(e,t,a)=>t in e?D(e,t,{enumerable:!0,configurable:!0,writable:!0,value:a}):e[t]=a,m=(e,t)=>{for(var a in t||(t={}))T.call(t,a)&&v(e,a,t[a]);if(w)for(var a of w(t))P.call(t,a)&&v(e,a,t[a]);return e};import{p as z}from"./chunk-JWPE2WC7-AgL9s0ji.js";import{_ as u,A as x,D as A,e as E,l as y,b as F,a as W,n as _,o as N,g as L,s as M,y as Y,B as I,p as O}from"./mermaid.core-BJJQOL44.js";import{p as j}from"./cynefin-VYW2F7L2-CiTWqNti.js";import"./index-BOcJ5oi2.js";var G=I.packet,b,B=(b=class{constructor(){this.packet=[],this.setAccTitle=F,this.getAccTitle=W,this.setDiagramTitle=_,this.getDiagramTitle=N,this.getAccDescription=L,this.setAccDescription=M}getConfig(){const t=x(m(m({},G),Y().packet));return t.showBits&&(t.paddingY+=10),t}getPacket(){return this.packet}pushWord(t){t.length>0&&this.packet.push(t)}clear(){O(),this.packet=[]}},u(b,"PacketDB"),b),H=1e4,K=u((e,t)=>{z(e,t);let a=-1,o=[],l=1;const{bitsPerRow:c}=t.getConfig();for(let{start:r,end:s,bits:n,label:d}of e.blocks){if(r!==void 0&&s!==void 0&&s<r)throw new Error(`Packet block ${r} - ${s} is invalid. End must be greater than start.`);if(r!=null||(r=a+1),r!==a+1)throw new Error(`Packet block ${r} - ${s!=null?s:r} is not contiguous. It should start from ${a+1}.`);if(n===0)throw new Error(`Packet block ${r} is invalid. Cannot have a zero bit field.`);for(s!=null||(s=r+(n!=null?n:1)-1),n!=null||(n=s-r+1),a=s,y.debug(`Packet block ${r} - ${a} with label ${d}`);o.length<=c+1&&t.getPacket().length<H;){const[p,i]=R({start:r,end:s,bits:n,label:d},l,c);if(o.push(p),p.end+1===l*c&&(t.pushWord(o),o=[],l++),!i)break;({start:r,end:s,bits:n,label:d}=i)}}t.pushWord(o)},"populate"),R=u((e,t,a)=>{if(e.start===void 0)throw new Error("start should have been set during first phase");if(e.end===void 0)throw new Error("end should have been set during first phase");if(e.start>e.end)throw new Error(`Block start ${e.start} is greater than block end ${e.end}.`);if(e.end+1<=t*a)return[e,void 0];const o=t*a-1,l=t*a;return[{start:e.start,end:o,label:e.label,bits:o-e.start},{start:l,end:e.end,label:e.label,bits:e.end-l}]},"getNextFittingBlock"),$={parser:{yy:void 0},parse:u(async e=>{var o;const t=await j("packet",e),a=(o=$.parser)==null?void 0:o.yy;if(!(a instanceof B))throw new Error("parser.parser?.yy was not a PacketDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.");y.debug(t),K(t,a)},"parse")},U=u((e,t,a,o)=>{const l=o.db,c=l.getConfig(),{rowHeight:r,paddingY:s,bitWidth:n,bitsPerRow:d}=c,p=l.getPacket(),i=l.getDiagramTitle(),h=r+s,g=h*(p.length+1)-(i?0:r),k=n*d+2,f=A(t);f.attr("viewBox",`0 0 ${k} ${g}`),E(f,g,k,c.useMaxWidth);for(const[C,S]of p.entries())X(f,S,C,c);f.append("text").text(i).attr("x",k/2).attr("y",g-h/2).attr("dominant-baseline","middle").attr("text-anchor","middle").attr("class","packetTitle")},"draw"),X=u((e,t,a,{rowHeight:o,paddingX:l,paddingY:c,bitWidth:r,bitsPerRow:s,showBits:n})=>{const d=e.append("g"),p=a*(o+c)+c;for(const i of t){const h=i.start%s*r+1,g=(i.end-i.start+1)*r-l;if(d.append("rect").attr("x",h).attr("y",p).attr("width",g).attr("height",o).attr("class","packetBlock"),d.append("text").attr("x",h+g/2).attr("y",p+o/2).attr("class","packetLabel").attr("dominant-baseline","middle").attr("text-anchor","middle").text(i.label),!n)continue;const k=i.end===i.start,f=p-2;d.append("text").attr("x",h+(k?g/2:0)).attr("y",f).attr("class","packetByte start").attr("dominant-baseline","auto").attr("text-anchor",k?"middle":"start").text(i.start),k||d.append("text").attr("x",h+g).attr("y",f).attr("class","packetByte end").attr("dominant-baseline","auto").attr("text-anchor","end").text(i.end)}},"drawWord"),q={draw:U},J={byteFontSize:"10px",startByteColor:"black",endByteColor:"black",labelColor:"black",labelFontSize:"12px",titleColor:"black",titleFontSize:"14px",blockStrokeColor:"black",blockStrokeWidth:"1",blockFillColor:"#efefef"},Q=u(({packet:e}={})=>{const t=x(J,e);return`
	.packetByte {
		font-size: ${t.byteFontSize};
	}
	.packetByte.start {
		fill: ${t.startByteColor};
	}
	.packetByte.end {
		fill: ${t.endByteColor};
	}
	.packetLabel {
		fill: ${t.labelColor};
		font-size: ${t.labelFontSize};
	}
	.packetTitle {
		fill: ${t.titleColor};
		font-size: ${t.titleFontSize};
	}
	.packetBlock {
		stroke: ${t.blockStrokeColor};
		stroke-width: ${t.blockStrokeWidth};
		fill: ${t.blockFillColor};
	}
	`},"styles"),rt={parser:$,get db(){return new B},renderer:q,styles:Q};export{rt as diagram};
