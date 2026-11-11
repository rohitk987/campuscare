'use client';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {LoaderCircle} from 'lucide-react';
import {categories} from '@/lib/domain';
type ApiError = Error & {status:number};
type SelectOption = string | {value:string;label:string};
type PickerProps = {value:string;onChange:(value:string)=>void;options:SelectOption[];placeholder?:string;label?:string;disabled?:boolean};
type FieldProps = {label:string;value:string|number;onChange:(value:string)=>void;type?:string;hint?:string;multiline?:boolean;required?:boolean;min?:number;max?:number;step?:number|string;minLength?:number;maxLength?:number;placeholder?:string;readOnly?:boolean;disabled?:boolean;autoComplete?:string};
function errorMessage(value:unknown,fallback:string){return typeof value==='object'&&value!==null&&'error' in value&&typeof value.error==='string'?value.error:fallback;}
export async function api<T=Record<string,unknown>>(action:string,data:Record<string,unknown>={}){const r=await fetch('/api/campuscare',{method:'POST',headers:{'Content-Type':'application/json','X-Campuscare-Request':'1'},body:JSON.stringify({action,...data})});const j:unknown=await r.json();if(!r.ok){const e:ApiError=Object.assign(new Error(errorMessage(j,'Request failed. Please retry.')),{status:r.status});throw e;}return j as T;}
export async function read<T=Record<string,unknown>>(query:string){const r=await fetch('/api/campuscare?'+query,{cache:'no-store'});const j:unknown=await r.json();if(!r.ok){const e:ApiError=Object.assign(new Error(errorMessage(j,'Unable to load saved data.')),{status:r.status});throw e;}return j as T;}
export function Picker({value,onChange,options,placeholder='Select an option',label,disabled=false}:PickerProps){return <Select value={value||undefined} onValueChange={onChange} disabled={disabled}><SelectTrigger className="w-full" aria-label={label||placeholder}><SelectValue placeholder={placeholder}/></SelectTrigger><SelectContent>{options.map(option=>{const item=typeof option==='string'?{value:option,label:option}:option;return <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>})}</SelectContent></Select>}
export function Field({label,value,onChange,type='text',hint,multiline=false,required=false,min,max,step,minLength,maxLength,placeholder,readOnly,disabled,autoComplete}:FieldProps){const common={ 'aria-label':label,value:value??'',required,readOnly,disabled,placeholder,minLength,maxLength,className:'mt-2',onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange(event.currentTarget.value)};return <div className="field"><label>{label}{required?' *':''}{multiline?<Textarea {...common}/>:<Input {...common} type={type} min={min} max={max} step={step} autoComplete={autoComplete}/>}</label>{hint&&<small>{hint}</small>}</div>}
export function SelectField({label,...props}:PickerProps&{label:string}){return <div className="field"><label>{label}</label><Picker label={label} {...props}/></div>}
export function Empty({title='Nothing here yet',children}:{title?:string;children?:React.ReactNode}){return <div className="empty-state"><h3>{title}</h3><p className="body-copy">{children}</p></div>}
/** Categorical slots 1 to 8 follow the domain's category order; "Other" (and anything unknown) is neutral. */
export function categorySlot(category:string){const i=categories.indexOf(category);return i>=0&&i<8?i+1:0;}
export function CategoryChip({category}:{category:string}){return <span className="category-chip" style={{['--chip' as string]:`var(--color-category-${categorySlot(category)})`}}>{category}</span>}
export function PriorityBadge({score,band}:{score?:number;band?:string}){if(score==null||!band)return null;return <span className={'priority-badge band-'+band.toLowerCase()} title={`Priority score ${score} of 100`}><b>{score}</b>{band}</span>}
function nameSlot(name:string){let h=0;for(const c of name)h=(h*31+c.charCodeAt(0))>>>0;return h%8+1;}
export function Avatar({name,size='md'}:{name:string;size?:'sm'|'md'}){return <span className={'avatar avatar-'+size} style={{['--avatar' as string]:`var(--color-category-${nameSlot(name)})`}} aria-hidden="true">{initials(name)}</span>}
export function Meter({value,label}:{value:number;label?:string}){return <span className="meter" role="img" aria-label={label||`${Math.round(value*100)}%`}><span style={{['--v' as string]:Math.max(0,Math.min(1,value))}}/></span>}
export function Busy(){return <LoaderCircle size={17} className="loader keep-motion"/>}
export type Position = {latitude:number;longitude:number;accuracy:number;timestamp:number};
export function getPosition():Promise<Position>{return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('Location access is not supported by this browser.'));navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp}),e=>reject(new Error(e.code===1?'Location permission was denied. Enable it in your browser’s site settings and retry.':e.code===3?'Location check timed out. Move to a clearer area and retry.':'Your location is unavailable. Check your device location settings and retry.')),{enableHighAccuracy:true,maximumAge:0,timeout:18000});});}
export function ago(n:number){const h=Math.max(0,Math.floor((Date.now()-n)/3600000));return h<1?'Just now':h<24?`${h}h ago`:`${Math.floor(h/24)}d ago`;}
export function initials(n:string){return (n||'U').split(/[ @.]/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();}
