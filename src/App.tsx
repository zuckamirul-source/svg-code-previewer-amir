/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Download, 
  Trash2, 
  Image as ImageIcon, 
  Settings2, 
  CheckCircle2, 
  AlertCircle,
  Copy,
  Plus,
  Upload,
  Layers,
  LayoutGrid,
  List,
  Check,
  X,
  Stethoscope,
  FileArchive
} from 'lucide-react';
import JSZip from 'jszip';
import { svgToJpg, imageToJpg } from './lib/svg-utils';

interface AssetSlot {
  id: string;
  type: 'svg' | 'image';
  code?: string;
  file?: File;
  name: string;
}

function SvgPreview({ code }: { code: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    const blob = new Blob([code], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    setUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [code]);

  if (!url) return null;

  return (
    <img 
      src={url} 
      alt="SVG Preview" 
      className="w-full h-full object-contain pointer-events-none"
    />
  );
}

export default function App() {
  const [rawInput, setRawInput] = useState('');
  const [resolution, setResolution] = useState(() => {
    const saved = localStorage.getItem('svg-flux-resolution');
    return saved ? JSON.parse(saved) : { width: 2048, height: 2048 };
  });
  const [aspectRatio, setAspectRatio] = useState(1);
  const [lockAspect, setLockAspect] = useState(true);
  const [useOriginalSize, setUseOriginalSize] = useState(true);
  
  useEffect(() => {
    if (!lockAspect) {
      setAspectRatio(resolution.width / resolution.height);
    }
  }, [resolution, lockAspect]);

  const handleWidthChange = (val: number) => {
    if (lockAspect) {
      setResolution({ width: val, height: Math.round(val / aspectRatio) });
    } else {
      setResolution(prev => ({ ...prev, width: val }));
    }
  };

  const handleHeightChange = (val: number) => {
    if (lockAspect) {
      setResolution({ height: val, width: Math.round(val * aspectRatio) });
    } else {
      setResolution(prev => ({ ...prev, height: val }));
    }
  };

  const [showDimensions, setShowDimensions] = useState(false);
  const [targetSize, setTargetSize] = useState<number | null>(4); // In MB

  useEffect(() => {
    localStorage.setItem('svg-flux-resolution', JSON.stringify(resolution));
  }, [resolution]);
  const [useTargetSize, setUseTargetSize] = useState(false);
  const [downloadAsZip, setDownloadAsZip] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showSuccess, setShowSuccess] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<AssetSlot[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const abortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const presets = [
    { name: '4K', w: 3840, h: 2160 },
    { name: '2K', w: 2048, h: 2048 },
    { name: 'HD', w: 1920, h: 1080 },
    { name: 'SQ', w: 1024, h: 1024 },
  ];

  const handlePreset = (w: number, h: number) => {
    setResolution({ width: w, height: h });
  };

  // Extract SVG from text
  const textSvgs = React.useMemo(() => {
    if (!rawInput.trim()) return [];
    const svgRegex = /<svg[\s\S]*?<\/svg>/gi;
    const matches = rawInput.match(svgRegex) || [];
    return matches.map((code, index) => ({
      id: `text-svg-${index}`,
      type: 'svg' as const,
      code: code.trim(),
      name: `extracted_svg_${index + 1}`
    }));
  }, [rawInput]);

  useEffect(() => {
    if (useOriginalSize && textSvgs.length > 0) {
      const firstSvg = textSvgs[0];
      const parser = new DOMParser();
      const doc = parser.parseFromString(firstSvg.code, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (svg) {
        const viewBox = svg.getAttribute('viewBox');
        const svgW = svg.getAttribute('width');
        const svgH = svg.getAttribute('height');
        
        let dims = null;
        if (svgW && svgH && !isNaN(parseInt(svgW))) {
          dims = { width: parseInt(svgW), height: parseInt(svgH) };
        } else if (viewBox) {
          const parts = viewBox.split(/\s+/).map(Number);
          if (parts.length === 4) {
            dims = { width: parts[2], height: parts[3] };
          }
        }
        
        if (dims) {
          setResolution(dims);
          setAspectRatio(dims.width / dims.height);
        }
      }
    }
  }, [textSvgs, useOriginalSize]);

  useEffect(() => {
    if ((textSvgs.length > 0 || uploadedFiles.length > 0) && !isProcessing) {
      // Assets detected
    }
  }, [textSvgs.length, uploadedFiles.length, isProcessing]);

  const allAssets = [...textSvgs, ...uploadedFiles];
  const visibleAssets = allAssets.filter(asset => !completedIds.has(asset.id));

  const clearAll = useCallback(() => {
    setRawInput('');
    setUploadedFiles([]);
    setCompletedIds(new Set());
    setDownloadProgress(0);
  }, []);

  const extractDimensions = async (asset: AssetSlot) => {
    if (asset.type === 'svg' && asset.code) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(asset.code, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (svg) {
        const viewBox = svg.getAttribute('viewBox');
        const svgW = svg.getAttribute('width');
        const svgH = svg.getAttribute('height');
        
        if (svgW && svgH && !isNaN(parseInt(svgW))) {
          return { width: parseInt(svgW), height: parseInt(svgH) };
        } else if (viewBox) {
          const parts = viewBox.split(/\s+/).map(Number);
          if (parts.length === 4) {
            return { width: parts[2], height: parts[3] };
          }
        }
      }
    } else if (asset.file) {
      return new Promise<{ width: number, height: number }>((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(asset.file!);
        img.onload = () => {
          const dims = { width: img.naturalWidth, height: img.naturalHeight };
          URL.revokeObjectURL(url);
          resolve(dims);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({ width: resolution.width, height: resolution.height });
        };
        img.src = url;
      });
    }
    return null;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    const newAssets: AssetSlot[] = files.map((file, i) => ({
      id: `file-${Date.now()}-${i}`,
      type: (file.type.includes('svg') || file.name.endsWith('.svg')) ? 'svg' : 'image',
      file: file,
      name: file.name.split('.')[0].replace(/\s+/g, '_'), // Clean filenames
      code: (file.type.includes('svg') || file.name.endsWith('.svg')) ? '' : undefined
    }));

    // If it's an SVG file, also try to read its code for preview and dimension extraction
    for (const asset of newAssets) {
      if (asset.file && asset.file.type.includes('svg')) {
        const code = await asset.file.text();
        asset.code = code;
      }
      
      // Auto dimension for the newly added assets if it's the only one or "Sync" is on
      if (useOriginalSize || allAssets.length === 0) {
        const dims = await extractDimensions(asset);
        if (dims) {
          setResolution(dims);
          setAspectRatio(dims.width / dims.height);
        }
      }
    }

    setUploadedFiles(prev => [...prev, ...newAssets]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = async () => {
    if (visibleAssets.length === 0) return;

    setIsProcessing(true);
    setDownloadProgress(0);
    abortRef.current = false;

    try {
      const currentBatch = [...visibleAssets];
      const concurrencyLimit = 10;
      const zip = downloadAsZip ? new JSZip() : null;
      
      for (let i = 0; i < currentBatch.length; i += concurrencyLimit) {
        if (abortRef.current) break;

        const chunk = currentBatch.slice(i, i + concurrencyLimit);
        
        await Promise.all(chunk.map(async (item, indexInChunk) => {
          if (abortRef.current) return;
          
          const globalIndex = i + indexInChunk;
          let blob: Blob;
          
          try {
            if (item.type === 'svg' && item.code) {
              // Get original dimensions if requested
              let w = resolution.width;
              let h = resolution.height;

              if (useOriginalSize) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(item.code, 'image/svg+xml');
                const svg = doc.querySelector('svg');
                if (svg) {
                  const viewBox = svg.getAttribute('viewBox');
                  const svgW = svg.getAttribute('width');
                  const svgH = svg.getAttribute('height');
                  
                  if (svgW && svgH) {
                    w = parseInt(svgW);
                    h = parseInt(svgH);
                  } else if (viewBox) {
                    const parts = viewBox.split(/\s+/).map(Number);
                    if (parts.length === 4) {
                      w = parts[2];
                      h = parts[3];
                    }
                  }
                }
              }

              blob = await svgToJpg(
                item.code, 
                w, 
                h,
                useTargetSize ? (targetSize || 4) : undefined
              );
            } else if (item.file) {
              let w = resolution.width;
              let h = resolution.height;

              if (useOriginalSize) {
                // For images, we need to load them to get size
                const img = new Image();
                const url = URL.createObjectURL(item.file);
                await new Promise((resolve) => {
                  img.onload = () => {
                    w = img.naturalWidth;
                    h = img.naturalHeight;
                    URL.revokeObjectURL(url);
                    resolve(null);
                  };
                  img.src = url;
                });
              }

              blob = await imageToJpg(
                item.file,
                w,
                h,
                useTargetSize ? (targetSize || 4) : undefined
              );
            } else {
              return;
            }

            if (zip) {
              zip.file(`${item.name || (globalIndex + 1)}.jpg`, blob);
            } else {
              // High-speed individual download trigger
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `${item.name || (globalIndex + 1)}.jpg`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            }

            // Parallel Feedback Loop
            setCompletedIds(prev => new Set(prev).add(item.id));
          } catch (err) {
            console.error(`Failed unit ${globalIndex + 1}:`, err);
          }
        }));

        setDownloadProgress(Math.round(((i + chunk.length) / currentBatch.length) * 100));
        
        // Minimized breather to maintain high throughput
        await new Promise(r => setTimeout(r, 20));
      }

      if (!abortRef.current && zip) {
        setDownloadProgress(99);
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.download = `amirhub_assets_${Date.now()}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      if (!abortRef.current) {
        setShowSuccess(true);
        
        // Auto-refresh: Clear processed assets after success
        setRawInput('');
        setUploadedFiles([]);
        setCompletedIds(new Set());
      }
    } catch (error) {
      console.error('Processing failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const stopProcessing = () => {
    abortRef.current = true;
    setIsProcessing(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-bg-main text-zinc-700 font-sans bg-mesh">
      {/* Success Modal */}
      {showSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-sm bg-zinc-900/10">
          <div className="bg-white border border-zinc-100 p-8 rounded-3xl max-w-sm w-full text-center shadow-[0_32px_64px_-12px_rgba(0,0,0,0.1)]">
            <div className="w-20 h-20 bg-linear-to-tr from-brand-emerald/20 to-brand-cyan/20 text-brand-emerald rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
              <Check size={40} strokeWidth={2.5} />
            </div>
            <h3 className="text-2xl font-bold text-zinc-900 mb-2 tracking-tight">Export Complete</h3>
            <p className="text-zinc-500 text-sm mb-8 font-medium">Your assets have been processed with pixel-perfect precision.</p>
            <button 
              onClick={() => setShowSuccess(false)}
              className="w-full py-4 bg-zinc-900 text-white font-bold uppercase tracking-widest rounded-2xl hover:bg-black transition-all shadow-lg shadow-zinc-900/20 active:scale-95"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <nav className="h-20 border-b border-zinc-100 flex items-center justify-between px-6 sm:px-10 glass sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-linear-to-br from-brand-purple to-brand-pink rounded-xl flex items-center justify-center shadow-lg shadow-brand-purple/30 shrink-0">
            <Layers size={24} className="text-white" strokeWidth={2} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 leading-none">
              amir<span className="text-brand-purple">hub</span>
            </h1>
            <span className="text-[10px] text-zinc-400 uppercase tracking-[0.2em] font-bold mt-1">Pro Graphics v3.1</span>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-full bg-linear-to-r from-brand-purple/5 to-brand-cyan/5 border border-zinc-100">
            <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-brand-orange shadow-[0_0_8px_rgba(249,115,22,0.5)]' : 'bg-brand-emerald shadow-[0_0_8px_rgba(16,185,129,0.5)]'}`} />
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
              {isProcessing ? 'Active Synthesis' : 'Engine Ready'}
            </span>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Input Control Center */}
        <section className="w-full lg:w-96 border-b lg:border-b-0 lg:border-r border-zinc-100 bg-zinc-50/50 flex flex-col h-[400px] lg:h-auto overflow-hidden">
          <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-white/50 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brand-purple" />
              <h2 className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Input Stream</h2>
            </div>
            {visibleAssets.length > 0 && (
              <div className="text-[10px] font-bold text-brand-purple bg-brand-purple/10 px-2.5 py-1 rounded-full border border-brand-purple/10">
                {visibleAssets.length} ASSETS
              </div>
            )}
          </div>
          
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto no-scrollbar">
            <div className="p-6 space-y-6">
               <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-10 bg-white border border-dashed border-zinc-200 rounded-3xl flex flex-col items-center justify-center gap-3 hover:border-brand-purple/40 hover:bg-brand-purple/5 transition-all group relative overflow-hidden shadow-xs"
               >
                 <div className="w-14 h-14 rounded-2xl bg-zinc-50 flex items-center justify-center group-hover:scale-110 group-hover:bg-brand-purple/10 transition-all duration-500">
                   <Upload size={24} className="text-zinc-400 group-hover:text-brand-purple transition-colors" />
                 </div>
                 <div className="text-center">
                   <p className="text-xs font-bold text-zinc-900 mb-1">Import Assets</p>
                   <p className="text-[10px] text-zinc-400 uppercase tracking-widest">SVG • PNG • JPG</p>
                 </div>
               </button>
               <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                multiple 
                accept=".svg,.png,.jpg,.jpeg,.webp" 
               />

               <div className="relative group">
                 <div className="absolute top-3 right-3 text-[10px] font-bold text-zinc-300 uppercase tracking-widest pointer-events-none group-focus-within:text-brand-purple transition-colors">SVG Code</div>
                 <textarea
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  placeholder="Paste <svg> markup here..."
                  spellCheck={false}
                  className="relative w-full h-64 bg-white border border-zinc-200 rounded-2xl p-5 text-xs font-mono text-zinc-600 focus:outline-none focus:border-brand-purple/30 focus:ring-4 focus:ring-brand-purple/5 resize-none transition-all placeholder:text-zinc-300 shadow-sm custom-scrollbar"
                 />
               </div>
            </div>
          </div>

          {isProcessing && (
            <div className="p-6 bg-white border-t border-zinc-100 overflow-hidden shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
              <div className="flex items-center justify-between mb-4">
                 <div className="flex flex-col">
                   <span className="text-[10px] font-bold text-brand-purple uppercase tracking-widest">Synthesis Progress</span>
                   <span className="text-[11px] text-zinc-500 font-bold">
                      Batch Unit {completedIds.size + 1} / {allAssets.length}
                   </span>
                 </div>
                 <button 
                  onClick={stopProcessing}
                  className="p-2 bg-red-50 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-sm active:scale-90"
                 >
                   <X size={16} />
                 </button>
              </div>
              <div className="h-3 bg-zinc-100 rounded-full overflow-hidden p-0.5">
                 <div 
                  className="h-full bg-linear-to-r from-brand-purple via-brand-pink to-brand-orange rounded-full shadow-lg shadow-brand-pink/30 transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                 />
              </div>
            </div>
          )}
        </section>

        {/* Workspace Display */}
        <section className="flex-1 flex flex-col p-6 sm:p-10 bg-white/30 backdrop-blur-md overflow-hidden relative">
          <div className="flex items-center justify-between mb-8">
            <div className="flex flex-col">
              <h2 className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Queue Management</h2>
              <p className="text-sm text-zinc-600 font-medium">Process and verify your visual assets.</p>
            </div>
            
            <div className="flex gap-4">
              <div className="flex bg-zinc-50 rounded-xl p-1 border border-zinc-100">
                 <button 
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'}`}
                 >
                   <LayoutGrid size={18} />
                 </button>
                 <button 
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'}`}
                 >
                   <List size={18} />
                 </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-60">
            <div className="flex items-center justify-between mb-6 px-1">
               <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Active queue ({visibleAssets.length})</span>
               {allAssets.length > 0 && (
                 <button 
                  onClick={clearAll}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition-all group border border-red-100"
                 >
                   <Trash2 size={14} className="group-hover:rotate-12 transition-transform" />
                   <span className="text-[10px] font-bold uppercase">Clear All</span>
                 </button>
               )}
            </div>

            <div className={viewMode === 'grid' 
              ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-6" 
              : "flex flex-col gap-4"
            }>
              {visibleAssets.map((item, i) => {
                const isSvg = item.type === 'svg';
                return (
                  <div
                    key={item.id}
                    className={`${
                      viewMode === 'grid' 
                      ? 'aspect-square' 
                      : 'w-full h-28 sm:h-32'
                    } ${isSvg ? 'bg-brand-purple/[0.03]' : 'bg-brand-cyan/[0.03]'} border border-zinc-100 rounded-3xl flex relative overflow-hidden group/card ${isSvg ? 'hover:border-brand-purple/30' : 'hover:border-brand-cyan/30'} hover:bg-white transition-all shadow-sm hover:shadow-xl hover:-translate-y-1 duration-300`}
                  >
                    <div className="absolute top-4 left-4 text-[9px] font-bold bg-white text-zinc-400 px-2 py-1 rounded-lg uppercase z-10 border border-zinc-100 shadow-xs">
                      #{String(i + 1).padStart(2, '0')}
                    </div>
                    
                    <div className={`${viewMode === 'grid' ? 'w-full h-full p-8' : 'w-48 h-full p-6'} flex items-center justify-center group-hover/card:scale-110 transition-transform duration-500 pointer-events-none`}>
                      {item.type === 'svg' && item.code ? (
                        <div className="w-full h-full flex items-center justify-center overflow-hidden">
                          <SvgPreview code={item.code} />
                        </div>
                      ) : (
                        <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center overflow-hidden border border-zinc-100 shadow-xs">
                           {item.file ? (
                             <img 
                              src={URL.createObjectURL(item.file)} 
                              className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" 
                              onLoad={(e) => URL.revokeObjectURL((e.target as any).src)}
                             />
                           ) : (
                             <ImageIcon size={24} className="text-zinc-200" />
                           )}
                        </div>
                      )}
                    </div>
  
                    {viewMode === 'list' && (
                      <div className="flex-1 flex flex-col justify-center pr-10">
                         <div className="flex items-center gap-3 mb-2">
                           <h3 className="text-sm font-bold text-zinc-900 truncate max-w-[200px]">
                             {item.name}
                           </h3>
                           <span className={`text-[9px] px-2.5 py-1 rounded-full font-bold uppercase border border-white/40 ${isSvg ? 'bg-brand-purple/10 text-brand-purple' : 'bg-brand-cyan/10 text-brand-cyan'}`}>
                             {item.type}
                           </span>
                         </div>
                         <div className="flex items-center gap-6">
                            <div className="flex flex-col">
                              <span className="text-[8px] text-zinc-400 uppercase font-bold tracking-widest mb-0.5">Network Status</span>
                              <span className={`text-[10px] font-mono ${isProcessing && i === completedIds.size ? 'text-brand-orange animate-pulse' : 'text-brand-emerald'}`}>
                                {isProcessing && i === completedIds.size ? 'PROCESSING...' : 'READY_BUFFER'}
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[8px] text-zinc-400 uppercase font-bold tracking-widest mb-0.5">Export Target</span>
                              <span className="text-[10px] text-zinc-500 font-mono">JPG_4K_HDR</span>
                            </div>
                         </div>
                      </div>
                    )}
                  </div>
                );
              })}
              
              {visibleAssets.length === 0 && (
                 <div className="col-span-full py-40 flex flex-col items-center justify-center">
                   <div className="w-20 h-20 rounded-3xl bg-zinc-50 border border-dashed border-zinc-200 flex items-center justify-center mb-6 shadow-xs">
                      <Plus size={32} className="text-zinc-300" />
                   </div>
                   <p className="text-[11px] font-bold uppercase tracking-[0.4em] text-zinc-300">Awaiting Assets</p>
                 </div>
              )}
            </div>
          </div>
  
          {/* HUD Controller */}
          <div className="fixed lg:absolute bottom-8 left-6 right-6 z-40">
            <div className="max-w-5xl mx-auto p-3 bg-white/70 backdrop-blur-2xl border border-zinc-200/50 rounded-[2.5rem] overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15)] neon-glow-purple">
              <div className="bg-white rounded-[2rem] p-5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-6 shadow-xs border border-zinc-100">
                
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-8 flex-1">
                  {/* Export Format Toggle */}
                  <div className="hidden xl:flex items-center gap-4 pr-8 border-r border-zinc-100">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${downloadAsZip ? 'bg-amber-100 text-amber-600' : 'bg-zinc-100 text-zinc-400'}`}>
                        <FileArchive size={20} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-zinc-900 uppercase tracking-widest">Package Mode</span>
                        <span className="text-[9px] text-zinc-400 font-mono">ZIP_ARCHIVE</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => setDownloadAsZip(!downloadAsZip)}
                      className={`w-10 h-5 rounded-full relative transition-all duration-300 ${downloadAsZip ? 'bg-amber-500' : 'bg-zinc-200'}`}
                    >
                      <div 
                        className={`absolute inset-y-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-300 ${downloadAsZip ? 'left-[22px]' : 'left-0.5'}`}
                      />
                    </button>
                  </div>

                  {/* Resolution Controls */}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setShowDimensions(!showDimensions)}
                        className="flex items-center gap-2.5 group"
                      >
                        <div className="w-10 h-10 rounded-xl bg-zinc-50 flex items-center justify-center text-zinc-400 group-hover:bg-brand-purple group-hover:text-white transition-all shadow-xs active:scale-90">
                          <Settings2 size={18} />
                        </div>
                        <div className="text-left">
                          <p className="text-[10px] font-bold text-zinc-900 uppercase tracking-widest">Dimensions</p>
                          <p className={`text-[10px] font-mono lowercase transition-colors ${useOriginalSize ? 'text-brand-purple' : 'text-zinc-400'}`}>
                            {useOriginalSize ? 'auto_sync_on' : 'manual_override'}
                          </p>
                        </div>
                      </button>
  
                      <div className="flex items-center gap-4 px-4 py-1.5 bg-zinc-50 rounded-xl border border-zinc-100 shadow-xs">
                        <span className="text-[9px] font-bold text-zinc-500 uppercase">Auto Sync</span>
                        <button 
                          onClick={() => setUseOriginalSize(!useOriginalSize)}
                          className={`w-9 h-5 rounded-full relative transition-all duration-300 ${useOriginalSize ? 'bg-brand-purple' : 'bg-zinc-200'}`}
                        >
                          <div 
                            className={`absolute inset-y-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-300 ${useOriginalSize ? 'left-[18px]' : 'left-0.5'}`}
                          />
                        </button>
                      </div>
                    </div>
                    
                    {showDimensions && (
                      <div 
                        className={`flex items-center gap-3 bg-zinc-50 p-2.5 rounded-2xl border border-zinc-100 shadow-sm ${useOriginalSize ? 'opacity-40 pointer-events-none grayscale' : ''}`}
                      >
                        <div className="relative">
                          <input 
                            type="number" 
                            value={resolution.width}
                            onChange={(e) => handleWidthChange(parseInt(e.target.value) || 0)}
                            className="w-20 bg-white border border-zinc-100 rounded-xl px-3 py-2.5 text-xs text-center text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-purple/20 transition-all font-mono shadow-sm"
                          />
                          <span className="absolute -top-2 left-2 bg-white px-1 text-[8px] font-bold text-zinc-400 uppercase">W</span>
                        </div>
                        <button 
                          onClick={() => setLockAspect(!lockAspect)}
                          className={`p-1.5 rounded-lg transition-all ${lockAspect ? 'text-brand-purple bg-brand-purple/5' : 'text-zinc-300 hover:bg-zinc-100'}`}
                        >
                          <Layers size={14} className={lockAspect ? 'rotate-90 scale-110' : ''} />
                        </button>
                        <div className="relative">
                          <input 
                            type="number" 
                            value={resolution.height}
                            onChange={(e) => handleHeightChange(parseInt(e.target.value) || 0)}
                            className="w-20 bg-white border border-zinc-100 rounded-xl px-3 py-2.5 text-xs text-center text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-purple/20 transition-all font-mono shadow-sm"
                          />
                          <span className="absolute -top-2 left-2 bg-white px-1 text-[8px] font-bold text-zinc-400 uppercase">H</span>
                        </div>
                      </div>
                    )}
                  </div>
  
                  <div className="w-px h-14 bg-zinc-100 hidden sm:block" />
  
                  {/* Weight Control */}
                  <div className="flex-1 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-brand-cyan/5 flex items-center justify-center text-brand-cyan shadow-xs">
                          <Layers size={18} />
                        </div>
                        <div className="flex flex-col">
                          <p className="text-[10px] font-bold text-zinc-900 uppercase tracking-widest">Quality Density</p>
                          <p className="text-[10px] text-zinc-400 lowercase font-mono">buffer_target_mb</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-zinc-50 px-4 py-1.5 rounded-xl border border-zinc-100 shadow-xs">
                        <span className={`text-[9px] font-bold uppercase transition-colors ${useTargetSize ? 'text-brand-cyan' : 'text-zinc-400'}`}>
                          {useTargetSize ? 'LOCKED_ON' : 'DYNAMIC_OFF'}
                        </span>
                        <button 
                          onClick={() => setUseTargetSize(!useTargetSize)}
                          className={`w-9 h-5 rounded-full relative transition-all duration-300 ${useTargetSize ? 'bg-brand-cyan' : 'bg-zinc-200'}`}
                        >
                          <div 
                            className={`absolute inset-y-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-300 ${useTargetSize ? 'left-[18px]' : 'left-0.5'}`}
                          />
                        </button>
                      </div>
                    </div>
                    
                    <div className={`flex items-center gap-4 px-2 ${!useTargetSize ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="20" 
                        step="0.1"
                        disabled={!useTargetSize}
                        value={targetSize || 4}
                        onChange={(e) => setTargetSize(parseFloat(e.target.value))}
                        className="flex-1 h-2 accent-brand-cyan bg-zinc-100 rounded-full appearance-none cursor-pointer"
                      />
                      <div className="px-3 py-1 bg-zinc-900 rounded-lg shadow-lg">
                        <span className="text-[10px] font-bold text-white min-w-[35px] font-mono">{targetSize || 4}MB</span>
                      </div>
                    </div>
                  </div>
                </div>
  
                <button 
                  onClick={handleDownload}
                  disabled={isProcessing || visibleAssets.length === 0}
                  className={`w-full lg:w-72 py-6 rounded-3xl flex items-center justify-center gap-3 transition-all font-bold text-xs uppercase tracking-[0.2em] shadow-xl ${
                    isProcessing || visibleAssets.length === 0
                    ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-100'
                    : downloadAsZip 
                      ? 'bg-amber-500 text-white hover:bg-amber-600 hover:scale-[1.02] shadow-amber-500/30'
                      : 'bg-zinc-900 text-white hover:bg-black hover:scale-[1.02] shadow-zinc-900/40'
                  } active:scale-95`}
                >
                  {isProcessing ? (
                    <>
                      <div className="w-5 h-5 border-[3px] border-white/20 border-t-white rounded-full animate-spin" />
                      <span>{downloadProgress}% {downloadAsZip ? 'PACKING' : 'SYNC'}</span>
                    </>
                  ) : (
                    <>
                      {downloadAsZip ? <FileArchive size={22} strokeWidth={2.5} /> : <Download size={22} strokeWidth={2.5} />}
                      <span>{downloadAsZip ? 'Generate ZIP' : 'Process Assets'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="hidden sm:flex h-12 border-t border-zinc-100 bg-white/50 backdrop-blur-md items-center justify-between px-10 text-[10px] text-zinc-400 uppercase tracking-widest font-bold shrink-0 relative z-10">
        <div className="flex gap-8">
          <div className="flex items-center gap-2">
             <div className="w-1.5 h-1.5 rounded-full bg-brand-emerald animate-pulse" />
             <span>Neural Core: <span className="text-zinc-600">Online</span></span>
          </div>
          <div className="flex items-center gap-2">
             <div className="w-1.5 h-1.5 rounded-full bg-brand-purple" />
             <span>Worker Sync: <span className="text-zinc-600">Encrypted</span></span>
          </div>
        </div>
        <div className="flex gap-8">
          <span className="hover:text-brand-purple transition-colors cursor-default">Synthesis Platform v3.1.5</span>
          <span className="text-zinc-300">|</span>
          <span className="text-zinc-500 font-mono">B0-X9-R4</span>
        </div>
      </footer>
    </div>
  );
}

