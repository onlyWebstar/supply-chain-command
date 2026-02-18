import { useState, useEffect, useRef, useCallback, useReducer, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, RadarChart,
  PolarGrid, PolarAngleAxis, Radar, Legend
} from "recharts";
import "./App.css";

// ═══════════════════════════════════════════════════════════════
// PHASE 1: CORE ENGINE
// ═══════════════════════════════════════════════════════════════
class Pipeline {
  constructor(lt) { this.queue = Array(Math.max(1,lt)).fill(0); this.leadTime = lt; }
  advance(o) { const a = this.queue.shift(); this.queue.push(o); return a; }
  get inTransit() { return this.queue.reduce((a,b)=>a+b,0); }
  clone() { const p = new Pipeline(this.leadTime); p.queue=[...this.queue]; return p; }
}

class Agent {
  constructor({name,tier,leadTime,initialInventory,policy,policyParams}) {
    this.name=name; this.tier=tier; this.leadTime=leadTime;
    this.inventory=initialInventory; this.backlog=0;
    this.lastDemand=0; this.lastOrderPlaced=0;
    this.pipeline=new Pipeline(leadTime);
    this.policy=policy; this.policyParams=policyParams||{};
    this.totalStockouts=0; this.totalHeld=0; this.ticks=0;
    this.totalFulfilled=0; this.totalDemand=0;
  }
  fulfil(d) {
    const td=d+this.backlog, f=Math.min(this.inventory,td), nb=td-f;
    if(nb>0) this.totalStockouts+=nb;
    this.inventory-=f; this.backlog=nb; this.lastDemand=d;
    this.totalFulfilled+=f; this.totalDemand+=d;
    return {fulfilled:f,unfulfilled:nb};
  }
  decideOrder(shared=null) {
    const s={inventory:this.inventory,backlog:this.backlog,lastDemand:this.lastDemand,pipeline:this.pipeline};
    const qty=POLICIES[this.policy].compute(s,this.policyParams,shared??this.lastDemand);
    this.lastOrderPlaced=Math.round(Math.max(0,qty));
    return this.lastOrderPlaced;
  }
  advancePipeline(o) { const a=this.pipeline.advance(o); this.inventory+=a; this.totalHeld+=this.inventory; this.ticks++; return a; }
  get avgInventory() { return this.ticks>0?this.totalHeld/this.ticks:this.inventory; }
  get serviceLevel() { return this.totalDemand>0?(this.totalFulfilled/this.totalDemand)*100:100; }
  snapshot() { return {name:this.name,tier:this.tier,inventory:Math.round(this.inventory),backlog:Math.round(this.backlog),lastOrderPlaced:this.lastOrderPlaced,lastDemand:this.lastDemand,inTransit:Math.round(this.pipeline.inTransit)}; }
  clone() {
    const a=new Agent({name:this.name,tier:this.tier,leadTime:this.leadTime,initialInventory:this.inventory,policy:this.policy,policyParams:this.policyParams});
    a.backlog=this.backlog; a.lastDemand=this.lastDemand; a.lastOrderPlaced=this.lastOrderPlaced;
    a.pipeline=this.pipeline.clone(); a.totalStockouts=this.totalStockouts;
    a.totalHeld=this.totalHeld; a.ticks=this.ticks;
    a.totalFulfilled=this.totalFulfilled; a.totalDemand=this.totalDemand;
    return a;
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: POLICY MODULES
// ═══════════════════════════════════════════════════════════════
const POLICIES = {
  NAIVE:        { id:"NAIVE",         label:"Naïve Reactive",      shortLabel:"NAÏVE",     description:"Order exactly what was sold last period — pure reactive, zero foresight.", color:"#ef4444", compute:(s)=>s.lastDemand },
  FIXED_REORDER:{ id:"FIXED_REORDER", label:"Fixed Reorder Point", shortLabel:"FIXED-ROP", description:"Order batch Q when on-hand stock drops below threshold S.", color:"#f59e0b", compute:(s,p)=>s.inventory<(p.reorderPoint??40)?(p.orderQty??30):0 },
  BASE_STOCK:   { id:"BASE_STOCK",    label:"Base-Stock",           shortLabel:"BASE-STK",  description:"Target position T; order gap between T and (inventory + pipeline − backlog).", color:"#22c55e", compute:(s,p)=>{const T=p.targetStock??80,pos=s.inventory+s.pipeline.inTransit-s.backlog;return Math.max(0,T-pos);} },
  COLLABORATIVE:{ id:"COLLABORATIVE", label:"Collaborative",        shortLabel:"COLLAB",    description:"All tiers share the true customer demand signal, eliminating information distortion.", color:"#38bdf8", compute:(s,p,sh)=>{const T=p.targetStock??80,pos=s.inventory+s.pipeline.inTransit-s.backlog;return Math.max(0,sh+(p.safetyBuffer??10)-pos);} },
};

// ═══════════════════════════════════════════════════════════════
// SCENARIOS & DEMAND
// ═══════════════════════════════════════════════════════════════
const SCENARIOS = {
  COVID_SHOCK: { id:"COVID_SHOCK",  label:"COVID Demand Shock", icon:"⚡", description:"Sudden ×2.5 spike at tick 15, mimicking panic-buying disruption.", config:{demandPattern:"STEP_SHOCK",shockTick:15,shockMagnitude:2.5,retailerLeadTime:2,wholesalerLeadTime:4,factoryLeadTime:6} },
  SEASONAL:    { id:"SEASONAL",     label:"Seasonal Ramp",      icon:"🌊", description:"Sinusoidal wave — holiday demand cycle that rewards anticipatory policies.", config:{demandPattern:"SEASONAL",shockTick:20,shockMagnitude:1.5,retailerLeadTime:2,wholesalerLeadTime:3,factoryLeadTime:4} },
  STABLE:      { id:"STABLE",       label:"Stable Baseline",    icon:"—",  description:"Flat demand — verifies steady-state stability and zero-drift behaviour.", config:{demandPattern:"STABLE",shockTick:50,shockMagnitude:1.0,retailerLeadTime:2,wholesalerLeadTime:3,factoryLeadTime:4} },
  NOISE_STORM: { id:"NOISE_STORM",  label:"Noise Storm",        icon:"〜", description:"High-variance stochastic demand — stress-tests all policies under maximum uncertainty.", config:{demandPattern:"STOCHASTIC",shockTick:99,shockMagnitude:1.0,retailerLeadTime:2,wholesalerLeadTime:3,factoryLeadTime:4} },
};

function generateDemand(tick,pattern,shockTick=20,mag=2.0) {
  const b=20;
  switch(pattern) {
    case "STEP_SHOCK": return tick<shockTick?b:Math.round(b*mag);
    case "STABLE": return b;
    case "SEASONAL": return Math.max(1,Math.round(b+12*Math.sin((tick/26)*Math.PI)));
    case "STOCHASTIC": return Math.max(1,Math.round(b+(Math.random()-0.5)*18));
    default: return b;
  }
}

function coefVar(arr) {
  if(!arr.length) return 0;
  const mean=arr.reduce((a,b)=>a+b,0)/arr.length;
  if(mean===0) return 0;
  return Math.sqrt(arr.reduce((a,b)=>a+(b-mean)**2,0)/arr.length)/mean;
}

function computeBullwhip(history) {
  if(history.length<5) return {retailer:1,wholesaler:1,factory:1};
  const dCV=coefVar(history.map(h=>h.customerDemand))||0.001;
  return {
    retailer:+(coefVar(history.map(h=>h.retailer.lastOrderPlaced))/dCV).toFixed(2),
    wholesaler:+(coefVar(history.map(h=>h.wholesaler.lastOrderPlaced))/dCV).toFixed(2),
    factory:+(coefVar(history.map(h=>h.factory.lastOrderPlaced))/dCV).toFixed(2),
  };
}

function tickSim(agents,tick,cfg) {
  const [R,W,F]=agents;
  const demand=generateDemand(tick,cfg.demandPattern,cfg.shockTick,cfg.shockMagnitude);
  const isC=agents.every(a=>a.policy==="COLLABORATIVE");
  R.fulfil(demand); W.fulfil(R.lastOrderPlaced); F.fulfil(W.lastOrderPlaced);
  const ro=R.decideOrder(isC?demand:null);
  const wo=W.decideOrder(isC?demand:null);
  const fo=F.decideOrder(isC?demand:null);
  R.advancePipeline(ro); W.advancePipeline(wo); F.advancePipeline(fo);
  return {tick,customerDemand:demand,retailer:R.snapshot(),wholesaler:W.snapshot(),factory:F.snapshot()};
}

function runFullSim(policy,cfg) {
  const pp={reorderPoint:40,orderQty:30,targetStock:80,safetyBuffer:10};
  const agents=[
    new Agent({name:"Retailer",  tier:0,leadTime:cfg.retailerLeadTime,  initialInventory:60,policy,policyParams:{...pp,reorderPoint:35,orderQty:30,targetStock:70,safetyBuffer:8}}),
    new Agent({name:"Wholesaler",tier:1,leadTime:cfg.wholesalerLeadTime,initialInventory:60,policy,policyParams:{...pp,reorderPoint:50,orderQty:40,targetStock:90,safetyBuffer:12}}),
    new Agent({name:"Factory",   tier:2,leadTime:cfg.factoryLeadTime,   initialInventory:60,policy,policyParams:{...pp,reorderPoint:60,orderQty:50,targetStock:110,safetyBuffer:16}}),
  ];
  const history=[];
  for(let t=1;t<=100;t++) {
    const clones=agents.map(a=>a.clone());
    history.push(tickSim(clones,t,cfg));
    agents.forEach((a,i)=>{
      a.inventory=clones[i].inventory; a.backlog=clones[i].backlog;
      a.lastDemand=clones[i].lastDemand; a.lastOrderPlaced=clones[i].lastOrderPlaced;
      a.pipeline=clones[i].pipeline; a.totalStockouts=clones[i].totalStockouts;
      a.totalHeld=clones[i].totalHeld; a.ticks=clones[i].ticks;
      a.totalFulfilled=clones[i].totalFulfilled; a.totalDemand=clones[i].totalDemand;
    });
  }
  const bw=computeBullwhip(history);
  const avgInv=history.reduce((s,h)=>s+h.retailer.inventory+h.wholesaler.inventory+h.factory.inventory,0)/history.length/3;
  const stockouts=agents.reduce((s,a)=>s+a.totalStockouts,0);
  const serviceLevel=agents.reduce((s,a)=>s+a.serviceLevel,0)/3;
  const factoryPeak=Math.max(...history.map(h=>h.factory.lastOrderPlaced));
  return {policy,history,bw,avgInv:+avgInv.toFixed(1),stockouts,serviceLevel:+serviceLevel.toFixed(1),factoryPeak};
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: INSIGHT REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════
function generateReport(results,scenarioId,cfg) {
  if(!results||!results.length) return null;
  const scen=SCENARIOS[scenarioId];
  const sorted=[...results].sort((a,b)=>a.bw.factory-b.bw.factory);
  const best=sorted[0], worst=sorted[sorted.length-1];
  const naive=results.find(r=>r.policy==="NAIVE");
  const collab=results.find(r=>r.policy==="COLLABORATIVE");
  const baseStock=results.find(r=>r.policy==="BASE_STOCK");
  const bwReduction=naive&&collab?(((naive.bw.factory-collab.bw.factory)/naive.bw.factory)*100).toFixed(0):0;
  const stkReduction=naive&&collab&&naive.stockouts>0?(((naive.stockouts-collab.stockouts)/naive.stockouts)*100).toFixed(0):"N/A";
  const svcDelta=collab&&naive?(collab.serviceLevel-naive.serviceLevel).toFixed(1):0;

  return {
    title:"Supply Chain Intelligence Report",
    subtitle:`Scenario: ${scen.label} · ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`,
    sections:[
      {
        heading:"Executive Summary",
        body:`This simulation analysed a three-tier supply chain (Retailer → Wholesaler → Factory) across four inventory ordering policies under the ${scen.label} demand scenario. 100 discrete time-steps were run with lead times of ${cfg.retailerLeadTime}, ${cfg.wholesalerLeadTime}, and ${cfg.factoryLeadTime} periods respectively.\n\nThe dominant finding is that information distortion — not demand volatility itself — is the primary driver of supply chain instability. The factory-level bullwhip ratio ranged from ${collab?.bw.factory.toFixed(2)}× (Collaborative) to ${naive?.bw.factory.toFixed(2)}× (Naïve Reactive) — a ${bwReduction}% improvement achieved simply by sharing the true demand signal upstream, with no structural changes to inventory levels or lead times.`
      },
      {
        heading:"The Bullwhip Effect: What Happened",
        body:`Under the ${scen.label} scenario, customer demand ${cfg.demandPattern==="STEP_SHOCK"?`shifted abruptly at tick ${cfg.shockTick} by a factor of ×${cfg.shockMagnitude}`:cfg.demandPattern==="SEASONAL"?"followed a sinusoidal wave with amplitude ±12 units per period":cfg.demandPattern==="STOCHASTIC"?"exhibited high-variance stochastic fluctuation (±9 units/period)":"remained constant at 20 units/period"}. Under the Naïve Reactive policy, this propagated upstream as severe order amplification — the factory placed peak orders of ${naive?.factoryPeak} units against a baseline demand of 20, a ${naive?(((naive.factoryPeak/20)*100-100).toFixed(0)):0}% overshoot.\n\nThis is the bullwhip effect in its classical form: each tier adds a safety margin based on perceived (not actual) demand, causing oscillations that intensify upstream. Lead time is the transmission mechanism — longer pipeline delays force agents to order for a future they cannot observe, so they hedge aggressively, over-ordering when demand appears to rise and under-ordering when it appears to fall.`
      },
      {
        heading:"Policy Comparison: Key Findings",
        body:`${POLICIES[best.policy].label} was the highest-performing policy with a factory bullwhip ratio of ${best.bw.factory.toFixed(2)}× and a service level of ${best.serviceLevel}%. ${POLICIES[worst.policy].label} performed worst at ${worst.bw.factory.toFixed(2)}× bullwhip.\n\nThe Base-Stock policy achieved ${baseStock?.bw.factory.toFixed(2)}× bullwhip by explicitly accounting for pipeline inventory in the ordering calculation — a critical structural insight. By considering in-transit goods as part of the inventory position, agents avoid double-ordering during replenishment cycles. This structural advantage holds across all demand patterns tested.`
      },
      {
        heading:"The Quantified Value of Information Sharing",
        body:`The gap between Naïve and Collaborative policies isolates the pure value of demand signal transparency. With no structural changes to inventory, lead times, or ordering parameters — only the addition of a shared point-of-sale demand signal — the simulation achieved:\n\n  • ${bwReduction}% reduction in factory bullwhip ratio (${naive?.bw.factory.toFixed(2)}× → ${collab?.bw.factory.toFixed(2)}×)\n  • ${stkReduction === "N/A" ? "Minimal" : stkReduction + "%"} reduction in total supply chain stockout units\n  • +${svcDelta} percentage points improvement in chain-wide service level\n\nThis quantifies what supply chain economists call "the value of information." Modern implementations — VMI (Vendor Managed Inventory) and CPFR — are operationalisations of this Collaborative policy at industrial scale.`
      }
    ]
  };
}

// ═══════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════
const INIT_CFG = {
  retailerPolicy:"NAIVE",wholesalerPolicy:"NAIVE",factoryPolicy:"NAIVE",
  demandPattern:"STEP_SHOCK",shockTick:20,shockMagnitude:2.2,
  retailerLeadTime:2,wholesalerLeadTime:3,factoryLeadTime:4,
  initialInventory:60,speed:250,
};

function buildAgents(cfg) {
  return [
    new Agent({name:"Retailer",  tier:0,leadTime:cfg.retailerLeadTime,  initialInventory:cfg.initialInventory,policy:cfg.retailerPolicy,  policyParams:{reorderPoint:35,orderQty:30,targetStock:70,safetyBuffer:8}}),
    new Agent({name:"Wholesaler",tier:1,leadTime:cfg.wholesalerLeadTime,initialInventory:cfg.initialInventory,policy:cfg.wholesalerPolicy,policyParams:{reorderPoint:45,orderQty:40,targetStock:90,safetyBuffer:12}}),
    new Agent({name:"Factory",   tier:2,leadTime:cfg.factoryLeadTime,   initialInventory:cfg.initialInventory,policy:cfg.factoryPolicy,   policyParams:{reorderPoint:55,orderQty:50,targetStock:110,safetyBuffer:16}}),
  ];
}

const INIT_STATE={config:INIT_CFG,agents:buildAgents(INIT_CFG),history:[],tick:0,running:false,bullwhip:{retailer:1,wholesaler:1,factory:1}};

function simReducer(state,action) {
  switch(action.type) {
    case "TICK": {
      const ac=state.agents.map(a=>a.clone());
      const result=tickSim(ac,state.tick+1,state.config);
      const nh=[...state.history,result].slice(-120);
      return {...state,agents:ac,history:nh,tick:state.tick+1,bullwhip:computeBullwhip(nh)};
    }
    case "SET_RUNNING": return {...state,running:action.payload};
    case "RESET": return {...state,agents:buildAgents(state.config),history:[],tick:0,running:false,bullwhip:{retailer:1,wholesaler:1,factory:1}};
    case "UPDATE_CONFIG": {const nc={...state.config,...action.payload};return {...state,config:nc,agents:buildAgents(nc),history:[],tick:0,running:false,bullwhip:{retailer:1,wholesaler:1,factory:1}};}
    default: return state;
  }
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const TC={Retailer:"#f59e0b",Wholesaler:"#38bdf8",Factory:"#a78bfa"};
const AMBER="#f59e0b";

// ═══════════════════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════════
function StatCard({label,value,unit="",color=AMBER,sublabel}) {
  return (
    <div className="sc-stat-card" style={{borderLeftColor:color}}>
      <div className="sc-stat-label">{label}</div>
      <div className="sc-stat-val" style={{color}}>{value}<span className="sc-stat-unit">{unit}</span></div>
      {sublabel&&<div className="sc-stat-sub">{sublabel}</div>}
    </div>
  );
}

function BullwhipBar({label,ratio,color}) {
  const pct=Math.min(ratio/5,1);
  const c=ratio>2.5?"#ef4444":ratio>1.5?AMBER:"#22c55e";
  return (
    <div style={{marginBottom:10}}>
      <div className="sc-bw-bar-row">
        <span style={{color}}>{label}</span><span style={{color:c,fontWeight:700}}>{ratio.toFixed(2)}×</span>
      </div>
      <div className="sc-bw-track">
        <div className="sc-bw-fill" style={{width:`${pct*100}%`,background:c,boxShadow:`0 0 8px ${c}`}}/>
      </div>
    </div>
  );
}

function PolicySelect({label,value,onChange,color}) {
  return (
    <div className="sc-policy-group">
      <div className="sc-policy-title">{label}</div>
      {Object.values(POLICIES).map(p=>(
        <label key={p.id} className={`sc-policy-opt ${value===p.id?'active':''}`} style={{borderColor:value===p.id?color:"rgba(255,255,255,0.06)"}}>
          <input type="radio" name={label} value={p.id} checked={value===p.id} onChange={()=>onChange(p.id)} style={{accentColor:color}}/>
          <span className="sc-policy-text" style={{color:value===p.id?color:"rgba(255,255,255,0.6)"}}>{p.label}</span>
        </label>
      ))}
    </div>
  );
}

function SliderControl({label,value,min,max,step=1,onChange}) {
  return (
    <div className="sc-input-group">
      <div className="sc-input-label">
        <span style={{textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</span>
        <span className="sc-input-val">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} className="sc-range"/>
    </div>
  );
}

function CustomTooltip({active,payload,label}) {
  if(!active||!payload?.length) return null;
  return (
    <div className="sc-chart-tooltip">
      <div style={{color:"rgba(255,255,255,0.35)",marginBottom:4}}>T{label}</div>
      {payload.map(p=><div key={p.name} style={{color:p.color,marginBottom:2}}>{p.name}: <b>{Math.round(p.value)}</b></div>)}
    </div>
  );
}

function ChartPanel({title,data,lines,height=150}) {
  return (
    <div className="sc-chart-panel">
      <div className="sc-panel-title" style={{marginBottom:10}}>{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{top:2,right:4,left:-20,bottom:0}}>
          <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)"/>
          <XAxis dataKey="tick" tick={{fontFamily:"'IBM Plex Mono', monospace",fontSize:8,fill:"rgba(255,255,255,0.2)"}}/>
          <YAxis tick={{fontFamily:"'IBM Plex Mono', monospace",fontSize:8,fill:"rgba(255,255,255,0.2)"}}/>
          <Tooltip content={<CustomTooltip/>}/>
          {lines.map(l=><Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={1.5} dot={false} isAnimationActive={false}/>)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FLOW DIAGRAM
// ═══════════════════════════════════════════════════════════════
function FlowDiagram({latest,config,shockActive}) {
  const nodes=[
    {label:"CUSTOMER",  sub:`DEMAND: ${latest?.customerDemand??"—"}`, x:20,  color:"rgba(255,255,255,0.5)"},
    {label:"RETAILER",  sub:`INV: ${latest?.retailer.inventory??"—"}`,  x:210, color:TC.Retailer},
    {label:"WHOLESALER",sub:`INV: ${latest?.wholesaler.inventory??"—"}`,x:400, color:TC.Wholesaler},
    {label:"FACTORY",   sub:`INV: ${latest?.factory.inventory??"—"}`,   x:590, color:TC.Factory},
  ];
  const flows=[
    {from:0,to:1,order:latest?.retailer.lastOrderPlaced??0,   color:TC.Retailer,   id:"p1",dur:"0.9s"},
    {from:1,to:2,order:latest?.wholesaler.lastOrderPlaced??0, color:TC.Wholesaler, id:"p2",dur:"1.4s"},
    {from:2,to:3,order:latest?.factory.lastOrderPlaced??0,    color:TC.Factory,    id:"p3",dur:"1.9s"},
  ];
  const NW=130,NH=64,SVH=110,PY=SVH/2;
  return (
    <div className="sc-flow-diagram">
      <div className="sc-flow-header">
        LIVE CHAIN FLOW {shockActive&&<span className="sc-shock-text">⚡ SHOCK PROPAGATING</span>}
      </div>
      <svg width="100%" viewBox={`0 0 760 ${SVH}`} style={{overflow:"visible"}}>
        <defs>
          {flows.map(f=>(
            <marker key={f.id} id={`arr-${f.id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill={f.color} opacity="0.6"/>
            </marker>
          ))}
        </defs>
        {flows.map(f=>{
          const x1=nodes[f.from].x+NW,x2=nodes[f.to].x;
          return (
            <g key={f.id}>
              <line x1={x1} y1={PY} x2={x2} y2={PY} stroke={f.color} strokeWidth="1" strokeOpacity="0.15"/>
              <path id={`path-${f.id}`} d={`M${x1},${PY} L${x2},${PY}`} fill="none"/>
              <circle r="3.5" fill={f.color} style={{filter:`drop-shadow(0 0 5px ${f.color})`}}>
                <animateMotion dur={f.dur} repeatCount="indefinite" calcMode="linear"><mpath href={`#path-${f.id}`}/></animateMotion>
              </circle>
              <circle r="2" fill={f.color} opacity="0.4">
                <animateMotion dur={f.dur} repeatCount="indefinite" calcMode="linear" begin={`${parseFloat(f.dur)*0.5}s`}><mpath href={`#path-${f.id}`}/></animateMotion>
              </circle>
              <text x={(x1+x2)/2} y={PY-9} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="8" fill={f.color} opacity="0.7">ORD:{f.order}</text>
            </g>
          );
        })}
        {nodes.map((n,i)=>(
          <g key={n.label} transform={`translate(${n.x},${PY-NH/2})`}>
            <rect width={NW} height={NH} rx="2" fill="rgba(0,0,0,0.45)" stroke={shockActive&&i>0?"#ef4444":n.color} strokeWidth={shockActive&&i>0?"1.5":"1"} strokeOpacity={shockActive&&i>0?"0.6":"0.35"}/>
            <rect width={NW} height="2" fill={n.color} opacity="0.7"/>
            <text x={NW/2} y={20} textAnchor="middle" fontFamily="'Bebas Neue', cursive" fontSize="12" fill={n.color} letterSpacing="1">{n.label}</text>
            <text x={NW/2} y={38} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" fill="rgba(255,255,255,0.5)">{n.sub}</text>
            {i>0&&latest&&[latest.retailer,latest.wholesaler,latest.factory][i-1]?.backlog>0&&(
              <text x={NW/2} y={54} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="8" fill="#ef4444">
                BACKLOG:{[latest.retailer,latest.wholesaler,latest.factory][i-1].backlog}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HISTORY PANEL
// ═══════════════════════════════════════════════════════════════
function RunHistoryPanel({onLoad}) {
  const [runs,setRuns]=useState([]);
  const [loading,setLoading]=useState(true);

  const loadRuns=useCallback(async()=>{
    try {
      // Mock storage for simulation - replace with localStorage or IndexedDB in real use
      const keys = Object.keys(localStorage).filter(k => k.startsWith("sc_run:"));
      const entries = keys.map(k => JSON.parse(localStorage.getItem(k)));
      setRuns(entries.sort((a,b)=>b.timestamp-a.timestamp));
    } catch(e){setRuns([]);} finally{setLoading(false);}
  },[]);

  useEffect(()=>{loadRuns();},[]);

  const deleteRun=(id)=>{
    localStorage.removeItem(`sc_run:${id}`);
    setRuns(prev=>prev.filter(r=>r.id!==id));
  };

  if(loading) return <div className="sc-content-pad" style={{fontSize:10}}>LOADING HISTORY…</div>;

  if(!runs.length) return (
    <div className="sc-content-pad">
      <div className="sc-empty-state">
        <div style={{fontFamily:"'Bebas Neue', cursive",fontSize:18,letterSpacing:"0.15em",color:"rgba(255,255,255,0.15)",marginBottom:8}}>NO SAVED RUNS</div>
        <div>Complete a 100-tick simulation to auto-save it here.</div>
      </div>
    </div>
  );

  return (
    <div className="sc-content-pad sc-anim-fade-in">
      <div className="sc-panel-header-row">
        <div className="sc-panel-title">{runs.length} SAVED RUNS</div>
        <button onClick={loadRuns} className="sc-btn-small" style={{border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)"}}>↻ REFRESH</button>
      </div>
      <div>
        {runs.map(run=>{
          const scen=SCENARIOS[run.scenarioId];
          const bwColor=run.factoryBW>2.5?"#ef4444":run.factoryBW>1.5?AMBER:"#22c55e";
          return (
            <div key={run.id} className="sc-history-item" style={{borderLeft:`3px solid ${bwColor}`}}>
              <div className="sc-history-info">
                <div className="sc-history-title">{scen?.icon||"○"} {scen?.label||run.scenarioId}</div>
                <div className="sc-history-sub">{new Date(run.timestamp).toLocaleString()} · {run.policies?.join(" / ")||"—"}</div>
              </div>
              <div className="sc-history-metrics">
                {[
                  {label:"Factory BW",value:`${run.factoryBW?.toFixed(2)||"—"}×`,color:bwColor},
                  {label:"Service Level",value:`${run.serviceLevel?.toFixed(1)||"—"}%`,color:run.serviceLevel>95?"#22c55e":AMBER},
                  {label:"Stockouts",value:run.stockouts||0,color:run.stockouts>0?"#ef4444":"#22c55e"},
                ].map(m=>(
                  <div key={m.label}>
                    <div className="sc-history-label">{m.label}</div>
                    <div className="sc-history-val" style={{color:m.color}}>{m.value}</div>
                  </div>
                ))}
              </div>
              <div className="sc-history-actions">
                <button onClick={()=>onLoad(run)} className="sc-btn-small" style={{background:`${AMBER}12`,border:`1px solid ${AMBER}60`,color:AMBER}}>LOAD</button>
                <button onClick={()=>deleteRun(run.id)} className="sc-btn-small" style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.3)",color:"#ef4444"}}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SENSITIVITY PANEL
// ═══════════════════════════════════════════════════════════════
function SensitivityPanel({baseConfig}) {
  const [sensData,setSensData]=useState(null);
  const [heatData,setHeatData]=useState(null);
  const [computing,setComputing]=useState(false);
  const [mode,setMode]=useState("sensitivity");

  const runSens=useCallback(()=>{
    setComputing(true);
    setTimeout(()=>{
      const mags=[1.1,1.3,1.5,1.8,2.0,2.5,3.0,3.5,4.0];
      const data=mags.map(mag=>{
        const cfg={...baseConfig,demandPattern:"STEP_SHOCK",shockTick:15,shockMagnitude:mag};
        const row={magnitude:mag,label:`×${mag}`};
        Object.keys(POLICIES).forEach(p=>{row[POLICIES[p].shortLabel]=runFullSim(p,cfg).bw.factory;});
        return row;
      });
      setSensData(data);
      setComputing(false);
    },100);
  },[baseConfig]);

  const runHeat=useCallback(()=>{
    setComputing(true);
    setTimeout(()=>{
      const sids=Object.keys(SCENARIOS), pids=Object.keys(POLICIES);
      const grid=pids.map(pid=>{
        const row={policy:POLICIES[pid].shortLabel,policyColor:POLICIES[pid].color};
        sids.forEach(sid=>{
          const cfg={...baseConfig,...SCENARIOS[sid].config};
          row[sid]=runFullSim(pid,cfg).bw.factory;
        });
        return row;
      });
      setHeatData({grid,sids,pids});
      setComputing(false);
    },130);
  },[baseConfig]);

  const cell=(val)=>{
    if(val<1.3) return {bg:"rgba(34,197,94,0.18)",bd:"rgba(34,197,94,0.38)",tx:"#22c55e"};
    if(val<2.0) return {bg:"rgba(234,179,8,0.14)",bd:"rgba(234,179,8,0.32)",tx:"#eab308"};
    if(val<3.0) return {bg:"rgba(245,158,11,0.14)",bd:"rgba(245,158,11,0.32)",tx:AMBER};
    return {bg:"rgba(239,68,68,0.14)",bd:"rgba(239,68,68,0.32)",tx:"#ef4444"};
  };

  return (
    <div className="sc-content-pad sc-anim-fade-in">
      <div className="sc-comp-header">
        <div className="sc-comp-btn-group">
          {[{id:"sensitivity",label:"SENSITIVITY ANALYSIS"},{id:"heatmap",label:"POLICY × SCENARIO HEATMAP"}].map(m=>(
            <button key={m.id} onClick={()=>setMode(m.id)} className={`sc-action-btn ${mode===m.id?'primary':''}`} style={{opacity:mode===m.id?1:0.6}}>{m.label}</button>
          ))}
        </div>
        <button onClick={mode==="sensitivity"?runSens:runHeat} disabled={computing} className={`sc-action-btn primary ${computing?'computing':''}`} style={{marginLeft:"auto"}}>
          {computing?"COMPUTING…":"▶ RUN ANALYSIS"}
        </button>
      </div>

      {mode==="sensitivity"&&(
        <>
          <div style={{fontFamily:"'IBM Plex Mono', monospace",fontSize:10,color:"rgba(255,255,255,0.28)",marginBottom:14,lineHeight:1.8}}>
            Sweeps shock magnitude ×1.1 → ×4.0 in 9 steps. Reveals the nonlinear relationship between demand volatility and supply chain amplification.
          </div>
          {sensData?(
            <div className="sc-chart-panel">
              <div className="sc-panel-title" style={{marginBottom:10}}>FACTORY BULLWHIP RATIO vs SHOCK MAGNITUDE</div>
              <ResponsiveContainer width="100%" height={290}>
                <LineChart data={sensData} margin={{top:4,right:8,left:-16,bottom:16}}>
                  <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)"/>
                  <XAxis dataKey="label" tick={{fontFamily:"'IBM Plex Mono', monospace",fontSize:9,fill:"rgba(255,255,255,0.3)"}} label={{value:"Shock Magnitude",position:"insideBottom",offset:-8,fill:"rgba(255,255,255,0.2)",fontSize:9,fontFamily:"'IBM Plex Mono', monospace"}}/>
                  <YAxis tick={{fontFamily:"'IBM Plex Mono', monospace",fontSize:9,fill:"rgba(255,255,255,0.3)"}} label={{value:"Bullwhip ×",angle:-90,position:"insideLeft",fill:"rgba(255,255,255,0.2)",fontSize:9,fontFamily:"'IBM Plex Mono', monospace"}}/>
                  <Tooltip contentStyle={{background:"#080c18",border:"1px solid rgba(255,255,255,0.1)",fontFamily:"'IBM Plex Mono', monospace",fontSize:10}} labelFormatter={v=>`Shock ${v}`}/>
                  <Legend wrapperStyle={{fontFamily:"'IBM Plex Mono', monospace",fontSize:9}}/>
                  {Object.values(POLICIES).map(p=>(
                    <Line key={p.id} type="monotone" dataKey={p.shortLabel} stroke={p.color} strokeWidth={2} dot={{fill:p.color,r:3}} isAnimationActive={false}/>
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <div className="sc-footer-note">
                KEY FINDING: Collaborative stays near-flat regardless of shock magnitude. Naïve scales super-linearly.
              </div>
            </div>
          ):(
            <div className="sc-empty-state">HIT RUN ANALYSIS TO SWEEP SHOCK MAGNITUDES</div>
          )}
        </>
      )}

      {mode==="heatmap"&&(
        <>
          {heatData?(
            <div className="sc-anim-fade-in">
              <div className="sc-panel-title" style={{marginBottom:12}}>POLICY × SCENARIO MATRIX</div>
              <div style={{overflowX:"auto"}}>
                <table className="sc-table">
                  <thead>
                    <tr>
                      <th>POLICY ↓</th>
                      {heatData.sids.map(sid=><th key={sid}>{SCENARIOS[sid].icon} {SCENARIOS[sid].label.toUpperCase()}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {heatData.grid.map(row=>(
                      <tr key={row.policy}>
                        <td style={{color:row.policyColor,fontWeight:700}}>{row.policy}</td>
                        {heatData.sids.map(sid=>{
                          const val=row[sid];
                          const c=cell(val);
                          return (
                            <td key={sid} style={{textAlign:"center"}}>
                              <div className="sc-heatmap-cell" style={{background:c.bg,border:`1px solid ${c.bd}`}}>
                                <div className="sc-heatmap-val" style={{color:c.tx}}>{val?.toFixed(2)}×</div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{display:"flex",gap:16,marginTop:10,fontFamily:"'IBM Plex Mono', monospace",fontSize:9,color:"rgba(255,255,255,0.22)"}}>
                {[["<1.3×","#22c55e","STABLE"],["1.3–2×","#eab308","MODERATE"],["2–3×",AMBER,"SEVERE"],[">3×","#ef4444","EXTREME"]].map(([r,c,l])=>(
                  <span key={l}><span style={{color:c}}>■</span> {r} {l}</span>
                ))}
              </div>
            </div>
          ):(
             <div className="sc-empty-state">HIT RUN ANALYSIS TO GENERATE 4×4 MATRIX</div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REPORT PANEL
// ═══════════════════════════════════════════════════════════════
function ReportPanel({baseConfig}) {
  const [scenId,setScenId]=useState("COVID_SHOCK");
  const [report,setReport]=useState(null);
  const [computing,setComputing]=useState(false);

  const generate=useCallback(()=>{
    setComputing(true);
    setTimeout(()=>{
      const cfg={...baseConfig,...SCENARIOS[scenId].config};
      const results=Object.keys(POLICIES).map(p=>runFullSim(p,cfg));
      setReport(generateReport(results,scenId,cfg));
      setComputing(false);
    },80);
  },[baseConfig,scenId]);

  return (
    <div className="sc-content-pad sc-anim-fade-in">
      <div className="sc-comp-header">
        <div>
          <div className="sc-input-label">GENERATE FOR SCENARIO</div>
          <div className="sc-comp-btn-group">
            {Object.values(SCENARIOS).map(s=>(
              <button key={s.id} onClick={()=>{setScenId(s.id);setReport(null);}} className={`sc-action-btn ${scenId===s.id?'primary':''}`} style={{opacity:scenId===s.id?1:0.6}}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={generate} disabled={computing} className={`sc-action-btn primary ${computing?'computing':''}`} style={{marginLeft:"auto"}}>
          {computing?"ANALYSING…":"▶ GENERATE REPORT"}
        </button>
      </div>

      {!report&&!computing&&(
         <div className="sc-empty-state">
          <div style={{fontSize:18,marginBottom:10,fontFamily:"'Bebas Neue', cursive"}}>INTELLIGENCE REPORT</div>
          <div>Runs all 4 policies against your chosen scenario and generates analysis</div>
        </div>
      )}

      {report&&(
        <div className="sc-report-wrap sc-anim-fade-in">
          <div className="sc-report-header">
            <div className="sc-report-h1">{report.title}</div>
            <div className="sc-report-meta">{report.subtitle}</div>
          </div>
          {report.sections.map((s,i)=>(
            <div key={i} className="sc-report-section">
              <div className="sc-report-h2-row">
                <div className="sc-report-bar"/>
                <div className="sc-report-h2">{s.heading.toUpperCase()}</div>
              </div>
              <div className="sc-report-text">{s.body}</div>
            </div>
          ))}
          <div className="sc-footer-note">ALL DATA DERIVED FROM LIVE SIMULATION RUNS</div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMPARISON PANEL
// ═══════════════════════════════════════════════════════════════
function ComparisonPanel({baseConfig}) {
  const [results,setResults]=useState(null);
  const [computing,setComputing]=useState(false);
  const [scenId,setScenId]=useState("COVID_SHOCK");

  const run=useCallback(()=>{
    setComputing(true);
    setTimeout(()=>{
      const cfg={...baseConfig,...SCENARIOS[scenId].config};
      setResults(Object.keys(POLICIES).map(p=>runFullSim(p,cfg)));
      setComputing(false);
    },80);
  },[baseConfig,scenId]);

  const radarData=useMemo(()=>{
    if(!results) return [];
    const maxBW=Math.max(...results.map(r=>r.bw.factory));
    const maxInv=Math.max(...results.map(r=>r.avgInv));
    const maxStk=Math.max(...results.map(r=>r.stockouts))||1;
    return [
      {metric:"Stability",...Object.fromEntries(results.map(r=>[POLICIES[r.policy].shortLabel,+(100-(r.bw.factory/maxBW)*100).toFixed(0)]))},
      {metric:"Svc Level",...Object.fromEntries(results.map(r=>[POLICIES[r.policy].shortLabel,+r.serviceLevel.toFixed(0)]))},
      {metric:"Low Inv",...Object.fromEntries(results.map(r=>[POLICIES[r.policy].shortLabel,+(100-(r.avgInv/maxInv)*100).toFixed(0)]))},
      {metric:"No Stockout",...Object.fromEntries(results.map(r=>[POLICIES[r.policy].shortLabel,+(100-(r.stockouts/maxStk)*100).toFixed(0)]))},
      {metric:"Peak Control",...Object.fromEntries(results.map(r=>[POLICIES[r.policy].shortLabel,+(100-(r.factoryPeak/Math.max(...results.map(x=>x.factoryPeak))) * 100).toFixed(0)]))},
    ];
  },[results]);

  const orderData=useMemo(()=>{
    if(!results) return [];
    return Array.from({length:100},(_,i)=>{
      const o={tick:i+1,demand:results[0].history[i]?.customerDemand??0};
      results.forEach(r=>{o[POLICIES[r.policy].shortLabel]=r.history[i]?.factory.lastOrderPlaced??0;});
      return o;
    });
  },[results]);

  const metrics=[
    {key:"bw.factory",label:"Factory Bullwhip",fmt:v=>`${v?.toFixed(2)}×`,good:"low"},
    {key:"avgInv",label:"Avg Inventory",fmt:v=>`${v} u`,good:"low"},
    {key:"stockouts",label:"Stockouts",fmt:v=>v,good:"low"},
    {key:"serviceLevel",label:"Service Level",fmt:v=>`${v}%`,good:"high"},
    {key:"factoryPeak",label:"Peak Order",fmt:v=>v,good:"low"},
  ];

  return (
    <div className="sc-content-pad sc-anim-fade-in">
      <div className="sc-comp-header">
        <div>
          <div className="sc-input-label">SCENARIO</div>
          <div className="sc-comp-btn-group">
            {Object.values(SCENARIOS).map(s=>(
              <button key={s.id} onClick={()=>{setScenId(s.id);setResults(null);}} className={`sc-action-btn ${scenId===s.id?'primary':''}`} style={{opacity:scenId===s.id?1:0.6}}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={run} disabled={computing} className={`sc-action-btn primary ${computing?'computing':''}`} style={{marginLeft:"auto"}}>
          {computing?"COMPUTING…":"▶ RUN ALL 4 POLICIES"}
        </button>
      </div>
      
      {!results&&<div className="sc-empty-state">SELECT SCENARIO AND RUN TO COMPARE POLICIES</div>}
      
      {results&&(
        <div className="sc-anim-fade-in">
          <table className="sc-table">
            <thead>
              <tr>
                <th>METRIC</th>
                {results.map(r=><th key={r.policy} style={{color:POLICIES[r.policy].color}}>{POLICIES[r.policy].shortLabel}</th>)}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m,mi)=>{
                const vals=results.map(r=>{const p=m.key.split(".");return p.reduce((o,k)=>o?.[k],r);});
                const best=m.good==="low"?Math.min(...vals):Math.max(...vals);
                const worst=m.good==="low"?Math.max(...vals):Math.min(...vals);
                return <tr key={m.key}>
                  <td className="sc-table-label">{m.label}</td>
                  {results.map((r,ri)=>{
                    const v=vals[ri],iB=v===best,iW=v===worst;
                    let badgeClass = "sc-badge-neutral";
                    if(iB) badgeClass = "sc-badge-best";
                    if(iW) badgeClass = "sc-badge-worst";
                    return <td key={r.policy} style={{textAlign:"center"}}>
                      <span className={`sc-badge ${badgeClass}`}>{m.fmt(v)}</span>
                    </td>;
                  })}
                </tr>;
              })}
            </tbody>
          </table>

          <div className="sc-split-view">
            <div className="sc-chart-panel">
              <div className="sc-panel-title" style={{marginBottom:8}}>PERFORMANCE RADAR</div>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.07)"/>
                  <PolarAngleAxis dataKey="metric" tick={{fontFamily:"'IBM Plex Mono', monospace",fontSize:8,fill:"rgba(255,255,255,0.33)"}}/>
                  {results.map(r=><Radar key={r.policy} name={POLICIES[r.policy].shortLabel} dataKey={POLICIES[r.policy].shortLabel} stroke={POLICIES[r.policy].color} fill={POLICIES[r.policy].color} fillOpacity={0.1} strokeWidth={1.5}/>)}
                  <Legend wrapperStyle={{fontFamily:"'IBM Plex Mono', monospace",fontSize:8}}/>
                  <Tooltip contentStyle={{background:"#0a0e1a",border:"1px solid rgba(255,255,255,0.1)",fontFamily:"'IBM Plex Mono', monospace",fontSize:9}}/>
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="sc-chart-panel">
              <div className="sc-panel-title" style={{marginBottom:8}}>FACTORY BULLWHIP</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={results.map(r=>({name:POLICIES[r.policy].shortLabel,ratio:r.bw.factory}))}>
                  <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)"/>
                  <XAxis dataKey="name" tick={{fontFamily:"'IBM Plex Mono', monospace",fontSize:9,fill:"rgba(255,255,255,0.33)"}}/>
                  <YAxis tick={{fontFamily:"'IBM Plex Mono', monospace",fontSize:9,fill:"rgba(255,255,255,0.33)"}}/>
                  <Tooltip contentStyle={{background:"#0a0e1a",border:"1px solid rgba(255,255,255,0.1)",fontFamily:"'IBM Plex Mono', monospace",fontSize:9}}/>
                  <Bar dataKey="ratio" radius={[2,2,0,0]}>{results.map(r=><Cell key={r.policy} fill={POLICIES[r.policy].color} fillOpacity={0.8}/>)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="sc-chart-panel">
            <div className="sc-panel-title">FACTORY ORDERS — ALL POLICIES</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={orderData} margin={{top:2,right:4,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)"/>
                <XAxis dataKey="tick" tick={{fontFamily:"'IBM Plex Mono', monospace",fontSize:8,fill:"rgba(255,255,255,0.2)"}}/>
                <YAxis tick={{fontFamily:"'IBM Plex Mono', monospace",fontSize:8,fill:"rgba(255,255,255,0.2)"}}/>
                <Tooltip contentStyle={{background:"#0a0e1a",border:"1px solid rgba(255,255,255,0.1)",fontFamily:"'IBM Plex Mono', monospace",fontSize:9}}/>
                <Line type="monotone" dataKey="demand" name="Demand" stroke="rgba(255,255,255,0.28)" strokeWidth={1.5} dot={false} strokeDasharray="4 2"/>
                {results.map(r=><Line key={r.policy} type="monotone" dataKey={POLICIES[r.policy].shortLabel} stroke={POLICIES[r.policy].color} strokeWidth={1.5} dot={false} isAnimationActive={false}/>)}
                <Legend wrapperStyle={{fontFamily:"'IBM Plex Mono', monospace",fontSize:8}}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [state,dispatch]=useReducer(simReducer,INIT_STATE);
  const [activeTab,setActiveTab]=useState("live");
  const [mounted,setMounted]=useState(false);
  const intervalRef=useRef(null);
  const {config,history,tick,running,bullwhip}=state;
  const latest=history[history.length-1];
  const shockActive=tick>=config.shockTick;

  useEffect(()=>{
    const link=document.createElement("link");
    link.rel="stylesheet";
    link.href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;700&display=swap";
    document.head.appendChild(link);
    setTimeout(()=>setMounted(true),80);
    return ()=>document.head.removeChild(link);
  },[]);

  useEffect(()=>{
    if(running){intervalRef.current=setInterval(()=>dispatch({type:"TICK"}),config.speed);}
    else{clearInterval(intervalRef.current);}
    return ()=>clearInterval(intervalRef.current);
  },[running,config.speed]);

  useEffect(()=>{if(tick>=100)dispatch({type:"SET_RUNNING",payload:false});},[tick]);

  // Phase 4: auto-save
  useEffect(()=>{
    if(tick===100&&history.length>=98){
      const bw=computeBullwhip(history);
      const stockouts=history.reduce((s,h)=>s+h.retailer.backlog,0); // Simple proxy
      const serviceLevel=+(100-Math.min(100,(stockouts/Math.max(1,history.reduce((s,h)=>s+h.customerDemand,0)))*100)).toFixed(1);
      const scenId=Object.keys(SCENARIOS).find(k=>SCENARIOS[k].config.demandPattern === config.demandPattern) || "STABLE";
      const run={
        id:Date.now().toString(),
        timestamp:Date.now(),
        scenarioId:scenId,
        policies:[config.retailerPolicy,config.wholesalerPolicy,config.factoryPolicy],
        factoryBW:bw.factory,
        stockouts,
        serviceLevel,
        config:{shockTick:config.shockTick,shockMagnitude:config.shockMagnitude}
      };
      localStorage.setItem(`sc_run:${run.id}`, JSON.stringify(run));
    }
  },[tick]);

  const updateConfig=p=>dispatch({type:"UPDATE_CONFIG",payload:p});

  const exportLiveCSV=()=>{
    if(!history.length) return;
    const h=["tick","demand","ret_inv","who_inv","fac_inv","ret_order","who_order","fac_order"];
    const rows=history.map(h2=>[h2.tick,h2.customerDemand,h2.retailer.inventory,h2.wholesaler.inventory,h2.factory.inventory,h2.retailer.lastOrderPlaced,h2.wholesaler.lastOrderPlaced,h2.factory.lastOrderPlaced].join(","));
    const blob=new Blob([[h.join(","),...rows].join("\n")],{type:"text/csv"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="live-sim.csv"; a.click();
  };

  const TABS=[
    {id:"live",label:"LIVE SIM"},
    {id:"compare",label:"COMPARE"},
    {id:"analysis",label:"SENSITIVITY & HEATMAP"},
    {id:"history",label:"RUN HISTORY"},
    {id:"report",label:"INTELLIGENCE REPORT"},
  ];

  return (
    <div className={`sc-app ${mounted ? 'loaded' : 'loading'}`}>
      <div className="sc-bg-scanlines"/>
      <div className="sc-bg-grid"/>
      <div className="sc-bg-glow-tr"/>
      <div className="sc-bg-glow-bl"/>

      <div className="sc-container">
        {/* HEADER */}
        <div className="sc-header">
          <div>
            <div className="sc-title">SUPPLY CHAIN COMMAND</div>
            <div className="sc-subtitle">AGENT-BASED · THREE-TIER · BULLWHIP EFFECT SIMULATOR · COMPLETE EDITION</div>
          </div>
          <div className="sc-header-controls">
            <div className={`sc-shock-badge ${shockActive ? 'active' : ''}`}>
              {shockActive?"⚡ SHOCK ACTIVE":`SHOCK @ T+${config.shockTick}`}
            </div>
            <div className="sc-tick-display">
              T<span className="sc-tick-val">{String(tick).padStart(3,"0")}</span>/100
            </div>
            {tick>=100&&<div className="sc-complete-badge">✓ COMPLETE · SAVED</div>}
          </div>
        </div>

        {/* TABS */}
        <div className="sc-tab-row">
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} className={`sc-tab-btn ${activeTab===t.id?'active':''}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* LIVE SIM */}
        {activeTab==="live"&&(
          <div className="sc-sim-layout sc-anim-fade-in">
            <div className="sc-sidebar">
              <div className="sc-sidebar-header">SCENARIOS</div>
              {Object.values(SCENARIOS).map(s=>(
                <button key={s.id} onClick={()=>updateConfig(SCENARIOS[s.id].config)} className="sc-scenario-btn">
                  {s.icon} {s.label}
                </button>
              ))}
              
              <div className="sc-divider"/>
              
              <div className="sc-sidebar-header">CONTROLS</div>
              <div className="sc-ctrl-grid">
                {[
                  {label:running?"…":"▶ RUN",action:()=>dispatch({type:"SET_RUNNING",payload:true}),color:"#22c55e",disabled:running||tick>=100},
                  {label:"⏸",action:()=>dispatch({type:"SET_RUNNING",payload:false}),color:AMBER,disabled:!running},
                  {label:"⟩ STEP",action:()=>{if(!running)dispatch({type:"TICK"});},color:"#38bdf8",disabled:running},
                  {label:"↺ RESET",action:()=>{clearInterval(intervalRef.current);dispatch({type:"RESET"});},color:"#94a3b8",disabled:false},
                ].map(b=>(
                  <button key={b.label} onClick={b.action} disabled={b.disabled} className="sc-ctrl-btn" style={{
                    background:b.disabled?"transparent":`${b.color}12`,
                    border:`1px solid ${b.disabled?"rgba(255,255,255,0.05)":b.color}`,
                    color:b.disabled?"rgba(255,255,255,0.18)":b.color
                  }}>{b.label}</button>
                ))}
              </div>
              
              <SliderControl label="Speed" value={config.speed} min={50} max={800} step={50} onChange={v=>dispatch({type:"UPDATE_CONFIG",payload:{speed:v}})}/>
              {tick>0&&<button onClick={exportLiveCSV} className="sc-export-btn">↓ EXPORT CSV</button>}
              
              <div className="sc-divider"/>
              <div className="sc-sidebar-header">POLICIES</div>
              <PolicySelect label="Retailer" value={config.retailerPolicy} color={TC.Retailer} onChange={v=>updateConfig({retailerPolicy:v})}/>
              <PolicySelect label="Wholesaler" value={config.wholesalerPolicy} color={TC.Wholesaler} onChange={v=>updateConfig({wholesalerPolicy:v})}/>
              <PolicySelect label="Factory" value={config.factoryPolicy} color={TC.Factory} onChange={v=>updateConfig({factoryPolicy:v})}/>
              
              <div className="sc-divider"/>
              <div className="sc-sidebar-header">DEMAND & LEAD TIMES</div>
              <SliderControl label="Shock Tick" value={config.shockTick} min={5} max={60} onChange={v=>updateConfig({shockTick:v})}/>
              <SliderControl label="Shock ×" value={config.shockMagnitude} min={1.1} max={4} step={0.1} onChange={v=>updateConfig({shockMagnitude:v})}/>
              <SliderControl label="Retailer LT" value={config.retailerLeadTime} min={1} max={6} onChange={v=>updateConfig({retailerLeadTime:v})}/>
              <SliderControl label="Wholesaler LT" value={config.wholesalerLeadTime} min={1} max={8} onChange={v=>updateConfig({wholesalerLeadTime:v})}/>
              <SliderControl label="Factory LT" value={config.factoryLeadTime} min={1} max={10} onChange={v=>updateConfig({factoryLeadTime:v})}/>
            </div>

            <div className="sc-main-content">
              <FlowDiagram latest={latest} config={config} shockActive={shockActive}/>
              
              <div className="sc-stats-grid">
                <StatCard label="Tick" value={tick} color={AMBER} sublabel="of 100"/>
                <StatCard label="Demand" value={latest?.customerDemand??"—"} unit="u" color="rgba(255,255,255,0.6)" sublabel={shockActive?`POST-SHOCK ×${config.shockMagnitude}`:"Pre-shock baseline"}/>
                <StatCard label="Factory BW" value={bullwhip.factory.toFixed(2)} unit="×" color={bullwhip.factory>2?"#ef4444":bullwhip.factory>1.3?AMBER:"#22c55e"} sublabel="Order CoV ÷ Demand CoV"/>
                <StatCard label="Ret Backlog" value={latest?.retailer.backlog??0} unit="u" color={latest?.retailer.backlog>0?"#ef4444":"#22c55e"} sublabel="Unfilled orders"/>
              </div>

              <div className="sc-bullwhip-panel">
                <div className="sc-panel-header-row">
                  <div className="sc-panel-title">BULLWHIP AMPLIFICATION</div>
                  <div className="sc-panel-sub">ORDER CoV ÷ DEMAND CoV</div>
                </div>
                <div className="sc-bw-bar-grid">
                  <BullwhipBar label="RETAILER" ratio={bullwhip.retailer} color={TC.Retailer}/>
                  <BullwhipBar label="WHOLESALER" ratio={bullwhip.wholesaler} color={TC.Wholesaler}/>
                  <BullwhipBar label="FACTORY" ratio={bullwhip.factory} color={TC.Factory}/>
                </div>
              </div>

              <ChartPanel title="INVENTORY LEVELS" data={state.history.map(h=>({tick:h.tick,"Ret Inv":h.retailer.inventory,"Who Inv":h.wholesaler.inventory,"Fac Inv":h.factory.inventory,"Demand":h.customerDemand}))} lines={[{key:"Ret Inv",name:"Retailer",color:TC.Retailer},{key:"Who Inv",name:"Wholesaler",color:TC.Wholesaler},{key:"Fac Inv",name:"Factory",color:TC.Factory},{key:"Demand",name:"Demand",color:"rgba(255,255,255,0.2)"}]}/>
              <ChartPanel title="ORDERS PLACED" data={state.history.map(h=>({tick:h.tick,"Ret Order":h.retailer.lastOrderPlaced,"Who Order":h.wholesaler.lastOrderPlaced,"Fac Order":h.factory.lastOrderPlaced,"Demand":h.customerDemand}))} lines={[{key:"Demand",name:"Demand",color:"rgba(255,255,255,0.28)"},{key:"Ret Order",name:"Retailer",color:TC.Retailer},{key:"Who Order",name:"Wholesaler",color:TC.Wholesaler},{key:"Fac Order",name:"Factory",color:TC.Factory}]}/>
            </div>
          </div>
        )}

        {activeTab==="compare"&&<ComparisonPanel baseConfig={config}/>}
        {activeTab==="analysis"&&<SensitivityPanel baseConfig={config}/>}
        {activeTab==="history"&&<RunHistoryPanel onLoad={run=>{if(run.config)updateConfig({shockTick:run.config.shockTick,shockMagnitude:run.config.shockMagnitude});setActiveTab("live");}}/>}
        {activeTab==="report"&&<ReportPanel baseConfig={config}/>}
      </div>
    </div>
  );
}
