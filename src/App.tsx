import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { useEffect, useRef, useState } from 'react';
import './App.css';

function App() {
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(100);
  const [loading, setLoading] = useState<boolean>(false);
  const [showTrimControls, setShowTrimControls] = useState<boolean>(false);
  const [showActions, setShowActions] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Format seconds to MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate time values
  const startTimeInSeconds = (startTime / 100) * videoDuration;
  const endTimeInSeconds = (endTime / 100) * videoDuration;
  const duration = endTimeInSeconds - startTimeInSeconds;

  // Load FFmpeg
  const loadFFmpeg = async (): Promise<FFmpeg> => {
    if (ffmpegRef.current) return ffmpegRef.current;

    const ffmpeg = new FFmpeg();

    // Add logging
    ffmpeg.on('log', ({ message }) => {
      console.log('FFmpeg log:', message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      console.log('FFmpeg progress:', progress);
    });

    try {
      // Self-hosted FFmpeg core files (no CDN dependency)
      const baseURL = '/ffmpeg';

      console.log('Loading FFmpeg core from:', baseURL);
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      console.log('FFmpeg loaded successfully');
    } catch (error) {
      console.error('Failed to load FFmpeg:', error);
      throw error;
    }

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  // Handle file selection
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file && file.type.startsWith('video/')) {
      setCurrentFile(file);

      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }

      const url = URL.createObjectURL(file);
      setCurrentUrl(url);
      setShowActions(true);
    } else {
      alert('Please select a valid video file');
    }
  };

  // Handle video metadata loaded
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setVideoDuration(videoRef.current.duration);
      setShowTrimControls(true);
      setEndTime(100);
    }
  };

  // Handle start time change
  const handleStartTimeChange = (value: number) => {
    if (value >= endTime) {
      setStartTime(endTime - 1);
    } else {
      setStartTime(value);
    }
    // Seek video to this position for preview
    if (videoRef.current) {
      const timeInSeconds = (value / 100) * videoDuration;
      videoRef.current.currentTime = timeInSeconds;
    }
  };

  // Handle end time change
  const handleEndTimeChange = (value: number) => {
    if (value <= startTime) {
      setEndTime(startTime + 1);
    } else {
      setEndTime(value);
    }
    // Seek video to this position for preview
    if (videoRef.current) {
      const timeInSeconds = (value / 100) * videoDuration;
      videoRef.current.currentTime = timeInSeconds;
    }
  };

  // Preview trim
  const handlePreviewTrim = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = startTimeInSeconds;
      videoRef.current.play();
    }
  };

  // Trim video
  const handleTrim = async () => {
    if (!currentFile) return;

    setLoading(true);

    try {
      console.log('Starting trim process...');
      const ffmpeg = await loadFFmpeg();
      console.log('FFmpeg loaded');

      // Write input file
      console.log('Writing input file...');
      await ffmpeg.writeFile('input.mp4', await fetchFile(currentFile));
      console.log('Input file written');

      // Trim video
      console.log('Executing FFmpeg command...');
      console.log(`Start: ${startTimeInSeconds}s, Duration: ${duration}s`);

      // Use stream copy for maximum speed (no re-encoding)
      // -ss before -i: fast seek to nearest keyframe
      // -c copy: no re-encoding (much faster)
      // Note: May start slightly before requested time due to keyframe positions
      const exitCode = await ffmpeg.exec([
        '-ss',
        startTimeInSeconds.toString(),
        '-i',
        'input.mp4',
        '-t',
        duration.toString(),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        'output.mp4',
      ]);

      console.log('FFmpeg execution complete with exit code:', exitCode);

      if (exitCode !== 0) {
        throw new Error(`FFmpeg failed with exit code ${exitCode}`);
      }

      // List files to verify output exists
      const files = await ffmpeg.listDir('/');
      console.log('Files in FFmpeg filesystem:', files);

      // Read output
      console.log('Reading output file...');
      const data = await ffmpeg.readFile('output.mp4');
      console.log('Output file read, data type:', typeof data, 'length:', data.length);

      // Validate data
      if (!data || data.length === 0) {
        throw new Error('Output file is empty');
      }

      // Create download - convert to regular Uint8Array
      const blob = new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
      console.log('Blob created, size:', blob.size, 'bytes');

      if (blob.size === 0) {
        throw new Error('Created blob is empty');
      }

      const url = URL.createObjectURL(blob);
      console.log('Blob URL created:', url);

      const fileName = `trimmed-${currentFile.name}`;

      // Create a temporary link and trigger download with multiple methods
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';

      // Make it invisible but part of the document
      a.style.cssText = 'display:none;position:fixed;top:0;left:0;';
      document.body.appendChild(a);

      console.log('Triggering download for:', fileName);
      console.log('Link element:', a);
      console.log('Href:', a.href);
      console.log('Download attr:', a.download);

      // Try multiple click methods
      try {
        // Method 1: Direct click
        a.click();
        console.log('Direct click attempted');
      } catch (e) {
        console.error('Direct click failed:', e);

        // Method 2: Dispatch click event
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
        });
        a.dispatchEvent(clickEvent);
        console.log('Event dispatch attempted');
      }

      // Keep the link longer to ensure download starts
      setTimeout(() => {
        console.log('Starting cleanup...');
        if (document.body.contains(a)) {
          document.body.removeChild(a);
        }
        // Don't revoke URL yet - keep it available
      }, 5000);

      // Show success message with option to try again
      const message =
        'Video trimmed successfully! ✅\n\nIf the download didn\'t start:\n1. Check your Downloads folder\n2. Click "OK" to open the video in a new tab\n3. Right-click the video and select "Save video as..."';

      if (confirm(message)) {
        // Open in new tab as fallback
        window.open(url, '_blank');
      }

      // Cleanup after longer delay
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 30000);
    } catch (error) {
      console.error('Error trimming video:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Error trimming video: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  // Download original
  const handleDownload = () => {
    if (currentFile && currentUrl) {
      const a = document.createElement('a');
      a.href = currentUrl;
      a.download = currentFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // Share video
  const handleShare = async () => {
    if (!currentFile) return;

    setLoading(true);

    try {
      console.log('Starting share process...');
      const ffmpeg = await loadFFmpeg();

      await ffmpeg.writeFile('input.mp4', await fetchFile(currentFile));
      await ffmpeg.exec([
        '-ss',
        startTimeInSeconds.toString(),
        '-i',
        'input.mp4',
        '-t',
        duration.toString(),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        'output.mp4',
      ]);

      const data = await ffmpeg.readFile('output.mp4');

      if (!data || data.length === 0) {
        throw new Error('Output file is empty');
      }

      const blob = new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });

      if (blob.size === 0) {
        throw new Error('Created blob is empty');
      }

      const file = new File([blob], `trimmed-${currentFile.name}`, { type: 'video/mp4' });

      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Trimmed Video',
          text: 'Your trimmed video is ready',
        });
      } else {
        alert('Share not supported. Video will download instead.');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      }
    } catch (error) {
      console.error('Error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Error: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  // Clear all
  const handleClear = () => {
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    setCurrentFile(null);
    setCurrentUrl(null);
    setVideoDuration(0);
    setStartTime(0);
    setEndTime(100);
    setShowActions(false);
    setShowTrimControls(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [currentUrl]);

  return (
    <div className="max-w-3xl mx-auto p-5">
      <div className="bg-gray-100 py-3 px-2 rounded-xl mb-5 text-center">
        <input
          ref={fileInputRef}
          type="file"
          id="videoInput"
          accept="video/*"
          onChange={handleFileChange}
          className="hidden"
        />
        <label
          htmlFor="videoInput"
          className="inline-block bg-blue-600 text-white py-3 px-8 text-base font-medium rounded-lg cursor-pointer transition-all hover:bg-blue-700 hover:shadow-lg active:scale-95"
        >
          Choose Video File
        </label>
        {currentFile && (
          <p className="mt-3 text-sm text-gray-600">
            Selected: <span className="font-medium">{currentFile.name}</span>
          </p>
        )}
      </div>

      {currentUrl && (
        <video
          ref={videoRef}
          id="videoPreview"
          src={currentUrl}
          controls
          onLoadedMetadata={handleLoadedMetadata}
          className="w-full max-w-[700px] my-5 mx-auto block rounded-xl shadow-md"
        >
          <track kind="captions" srcLang="en" label="English" />
        </video>
      )}

      {currentFile && (
        <div className="bg-blue-50 p-4 rounded-lg my-5 leading-relaxed text-sm">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <span className="text-gray-600 block mb-1">File Name</span>
              <span className="font-medium">{currentFile.name}</span>
            </div>
            <div>
              <span className="text-gray-600 block mb-1">Size</span>
              <span className="font-medium">{(currentFile.size / (1024 * 1024)).toFixed(2)} MB</span>
            </div>
            <div>
              <span className="text-gray-600 block mb-1">Type</span>
              <span className="font-medium">{currentFile.type}</span>
            </div>
          </div>
        </div>
      )}

      {showTrimControls && (
        <div className="bg-white border-2 border-gray-300 rounded-xl p-5 my-5">
          <h3 className="text-gray-600 mb-4 text-lg font-semibold">✂️ Trim Video</h3>

          <div className="my-6">
            <div className="flex justify-between mb-3 text-sm font-medium text-gray-600">
              <span>Start: {formatTime(startTimeInSeconds)}</span>
              <span>Duration: {formatTime(duration)}</span>
              <span>End: {formatTime(endTimeInSeconds)}</span>
            </div>

            {/* Dual-handle range slider */}
            <div className="relative h-12 flex items-center">
              {/* Track background */}
              <div className="absolute w-full h-2 bg-gray-300 rounded-full"></div>

              {/* Active range */}
              <div
                className="absolute h-2 bg-green-500 rounded-full"
                style={{
                  left: `${startTime}%`,
                  width: `${endTime - startTime}%`,
                }}
              ></div>

              {/* Start handle */}
              <input
                type="range"
                min="0"
                max="100"
                value={startTime}
                step="0.1"
                onChange={(e) => handleStartTimeChange(parseFloat(e.target.value))}
                className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-green-500 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:active:cursor-grabbing [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-green-500 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:active:cursor-grabbing [&::-moz-range-thumb]:border-0"
              />

              {/* End handle */}
              <input
                type="range"
                min="0"
                max="100"
                value={endTime}
                step="0.1"
                onChange={(e) => handleEndTimeChange(parseFloat(e.target.value))}
                className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-500 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:active:cursor-grabbing [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-blue-500 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:active:cursor-grabbing [&::-moz-range-thumb]:border-0"
              />
            </div>

            <div className="flex justify-between mt-2 text-xs text-gray-500">
              <span>🟢 Start</span>
              <span>🔵 End</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handlePreviewTrim}
            className="bg-blue-600 text-white border-none py-3 px-6 text-base rounded-md cursor-pointer m-1 transition-colors hover:bg-blue-700 md:w-auto w-full"
          >
            👁️ Preview Trim
          </button>
          <button
            type="button"
            onClick={handleTrim}
            className="bg-green-600 text-white border-none py-3 px-6 text-base rounded-md cursor-pointer m-1 transition-colors hover:bg-green-700 md:w-auto w-full"
          >
            ✂️ Trim & Download
          </button>
        </div>
      )}

      {loading && (
        <div className="fixed top-0 left-0 w-full h-full bg-black/70 flex flex-col justify-center items-center z-[1000]">
          <div className="border-[6px] border-gray-200 border-t-green-500 rounded-full w-16 h-16 animate-spin"></div>
          <p className="text-white mt-5 text-lg">Processing video...</p>
        </div>
      )}

      {showActions && (
        <div className="text-center my-8 p-5 bg-gray-50 rounded-xl">
          <button
            type="button"
            onClick={handleDownload}
            className="bg-blue-600 text-white border-none py-3 px-6 text-base rounded-md cursor-pointer m-1 transition-colors hover:bg-blue-700 md:w-auto w-full"
          >
            ⬇️ Download Original
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="bg-green-600 text-white border-none py-3 px-6 text-base rounded-md cursor-pointer m-1 transition-colors hover:bg-green-700 md:w-auto w-full"
          >
            📤 Share/Save to Photos
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="bg-blue-600 text-white border-none py-3 px-6 text-base rounded-md cursor-pointer m-1 transition-colors hover:bg-blue-700 md:w-auto w-full"
          >
            🗑️ Clear
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
