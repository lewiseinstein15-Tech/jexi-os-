import{p as nt}from"./chunk-JWPE2WC7-AgL9s0ji.js";import{a2 as T,a5 as G,b5 as it,g as st,s as ot,a as lt,b as ct,o as gt,n as ut,_ as d,l as W,c as dt,A as pt,D as ht,K as ft,e as mt,p as vt,B as xt}from"./mermaid.core-BJJQOL44.js";import{p as yt}from"./cynefin-VYW2F7L2-CiTWqNti.js";import{d as J}from"./arc-B0ZWtq4H.js";import{o as St}from"./ordinal-Cboi1Yqb.js";import"./index-BOcJ5oi2.js";import"./init-Gi6I4Gst.js";function wt(t,n){return n<t?-1:n>t?1:n>=t?0:NaN}function At(t){return t}function Ct(){var t=At,n=wt,w=null,b=T(0),c=T(G),p=T(0);function i(e){var r,l=(e=it(e)).length,h,A,D=0,f=new Array(l),s=new Array(l),m=+b.apply(this,arguments),E=Math.min(G,Math.max(-G,c.apply(this,arguments)-m)),k,L=Math.min(Math.abs(E)/l,p.apply(this,arguments)),g=L*(E<0?-1:1),C;for(r=0;r<l;++r)(C=s[f[r]=r]=+t(e[r],r,e))>0&&(D+=C);for(n!=null?f.sort(function(M,v){return n(s[M],s[v])}):w!=null&&f.sort(function(M,v){return w(e[M],e[v])}),r=0,A=D?(E-l*g)/D:0;r<l;++r,m=k)h=f[r],C=s[h],k=m+(C>0?C*A:0)+g,s[h]={data:e[h],index:r,value:C,startAngle:m,endAngle:k,padAngle:L};return s}return i.value=function(e){return arguments.length?(t=typeof e=="function"?e:T(+e),i):t},i.sortValues=function(e){return arguments.length?(n=e,w=null,i):n},i.sort=function(e){return arguments.length?(w=e,n=null,i):w},i.startAngle=function(e){return arguments.length?(b=typeof e=="function"?e:T(+e),i):b},i.endAngle=function(e){return arguments.length?(c=typeof e=="function"?e:T(+e),i):c},i.padAngle=function(e){return arguments.length?(p=typeof e=="function"?e:T(+e),i):p},i}var $t=xt.pie,I={sections:new Map,showData:!1},H=I.sections,V=I.showData,Dt=structuredClone($t),Tt=d(()=>structuredClone(Dt),"getConfig"),bt=d(()=>{H=new Map,V=I.showData,vt()},"clear"),kt=d(({label:t,value:n})=>{if(n<0)throw new Error(`"${t}" has invalid value: ${n}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);H.has(t)||(H.set(t,n),W.debug(`added new section: ${t}, with value: ${n}`))},"addSection"),zt=d(()=>H,"getSections"),Et=d(t=>{V=t},"setShowData"),Mt=d(()=>V,"getShowData"),Q={getConfig:Tt,clear:bt,setDiagramTitle:ut,getDiagramTitle:gt,setAccTitle:ct,getAccTitle:lt,setAccDescription:ot,getAccDescription:st,addSection:kt,getSections:zt,setShowData:Et,getShowData:Mt},Rt=d((t,n)=>{nt(t,n),n.setShowData(t.showData),t.sections.map(n.addSection)},"populateDb"),Lt={parse:d(async t=>{const n=await yt("pie",t);W.debug(n),Rt(n,Q)},"parse")},_t=d(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),Ft=_t,Ht=d(t=>{const n=[...t.values()].reduce((c,p)=>c+p,0),w=[...t.entries()].map(([c,p])=>({label:c,value:p})).filter(c=>c.value/n*100>=1);return Ct().value(c=>c.value).sort(null)(w)},"createPieArcs"),Nt=d((t,n,w,b)=>{var Z,q;W.debug(`rendering pie chart
`+t);const c=b.db,p=dt(),i=pt(c.getConfig(),p.pie),e=40,r=18,l=4,h=450,A=h,D=ht(n),f=D.append("g");f.attr("transform","translate("+A/2+","+h/2+")");const{themeVariables:s}=p;let[m]=ft(s.pieOuterStrokeWidth);m!=null||(m=2);const E=i.legendPosition,k=i.textPosition,L=i.donutHole>0&&i.donutHole<=.9?i.donutHole:0,g=Math.min(A,h)/2-e,C=J().innerRadius(L*g).outerRadius(g),M=J().innerRadius(g*k).outerRadius(g*k),v=f.append("g");v.append("circle").attr("cx",0).attr("cy",0).attr("r",g+m/2).attr("class","pieOuterCircle");const _=c.getSections(),Y=Ht(_),tt=[s.pie1,s.pie2,s.pie3,s.pie4,s.pie5,s.pie6,s.pie7,s.pie8,s.pie9,s.pie10,s.pie11,s.pie12];let N=0;_.forEach(a=>{N+=a});const U=Y.filter(a=>(a.data.value/N*100).toFixed(0)!=="0"),O=St(tt).domain([..._.keys()]);v.selectAll("mySlices").data(U).enter().append("path").attr("d",C).attr("fill",a=>O(a.data.label)).attr("class",a=>{let o="pieCircle";return i.highlightSlice==="hover"?o+=" highlightedOnHover":i.highlightSlice===a.data.label&&(o+=" highlighted"),o}),v.selectAll("mySlices").data(U).enter().append("text").text(a=>(a.data.value/N*100).toFixed(0)+"%").attr("transform",a=>"translate("+M.centroid(a)+")").style("text-anchor","middle").attr("class","slice");const et=f.append("text").text(c.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),R=[..._.entries()].map(([a,o])=>({label:a,value:o})),$=f.selectAll(".legend").data(R).enter().append("g").attr("class","legend");$.append("rect").attr("width",r).attr("height",r).style("fill",a=>O(a.label)).style("stroke",a=>O(a.label)),$.append("text").attr("x",r+l).attr("y",r-l).text(a=>c.getShowData()?`${a.label} [${a.value}]`:a.label);const z=Math.max(...$.selectAll("text").nodes().map(a=>{var o;return(o=a==null?void 0:a.getBoundingClientRect().width)!=null?o:0}));let F=h,P=A+e;const u=r+l,B=R.length*u;switch(E){case"center":$.attr("transform",(a,o)=>{const x=u*R.length/2,y=-z/2-(r+l),S=o*u-x;return"translate("+y+","+S+")"});break;case"top":F+=B,$.attr("transform",(a,o)=>{const x=g,y=-z/2-(r+l),S=o*u-x;return`translate(${y}, ${S})`}),v.attr("transform",()=>`translate(0, ${B+u})`);break;case"bottom":F+=B,$.attr("transform",(a,o)=>{const x=-g-u,y=-z/2-(r+l),S=o*u-x;return"translate("+y+","+S+")"});break;case"left":P+=r+l+z,$.attr("transform",(a,o)=>{const x=u*R.length/2,y=-g-(r+l),S=o*u-x;return"translate("+y+","+S+")"}),v.attr("transform",()=>`translate(${z+r+l}, 0)`);break;case"right":default:P+=r+l+z,$.attr("transform",(a,o)=>{const x=u*R.length/2,y=12*r,S=o*u-x;return"translate("+y+","+S+")"});break}const j=(q=(Z=et.node())==null?void 0:Z.getBoundingClientRect().width)!=null?q:0,at=A/2-j/2,rt=A/2+j/2,K=Math.min(0,at),X=Math.max(P,rt)-K;D.attr("viewBox",`${K} 0 ${X} ${F}`),mt(D,F,X,i.useMaxWidth)},"draw"),Ot={draw:Nt},Kt={parser:Lt,db:Q,renderer:Ot,styles:Ft};export{Kt as diagram};
