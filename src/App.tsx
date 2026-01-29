import { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
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
      // Use the official CDN with correct version - use esm for Vite
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';

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
        '-ss', startTimeInSeconds.toString(),
        '-i', 'input.mp4',
        '-t', duration.toString(),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        'output.mp4'
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
          cancelable: true
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
      const message = 'Video trimmed successfully! ✅\n\nIf the download didn\'t start:\n1. Check your Downloads folder\n2. Click "OK" to open the video in a new tab\n3. Right-click the video and select "Save video as..."';

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
        '-ss', startTimeInSeconds.toString(),
        '-i', 'input.mp4',
        '-t', duration.toString(),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        'output.mp4'
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
          text: 'Your trimmed video is ready'
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
    <div className="app">
      <h1>📹 Video Upload, Trim & Download</h1>

      <div className="upload-section">
        <h3>Select a video file</h3>
        <input
          ref={fileInputRef}
          type="file"
          id="videoInput"
          accept="video/*"
          onChange={handleFileChange}
        />
      </div>

      {currentUrl && (
        <video
          ref={videoRef}
          id="videoPreview"
          src={currentUrl}
          controls
          onLoadedMetadata={handleLoadedMetadata}
        />
      )}

      {currentFile && (
        <div className="info">
          <strong>File:</strong> {currentFile.name}<br />
          <strong>Size:</strong> {(currentFile.size / (1024 * 1024)).toFixed(2)} MB<br />
          <strong>Type:</strong> {currentFile.type}
        </div>
      )}

      {showTrimControls && (
        <div className="trim-controls">
          <h3>✂️ Trim Video</h3>
          <p className="trim-hint">💡 Drag the sliders to see video frames in real-time</p>

          <div className="range-container">
            <label>Start Time: <span>{formatTime(startTimeInSeconds)}</span></label>
            <input
              type="range"
              min="0"
              max="100"
              value={startTime}
              step="0.1"
              onInput={(e) => handleStartTimeChange(parseFloat(e.currentTarget.value))}
              onChange={(e) => handleStartTimeChange(parseFloat(e.target.value))}
            />
          </div>

          <div className="range-container">
            <label>End Time: <span>{formatTime(endTimeInSeconds)}</span></label>
            <input
              type="range"
              min="0"
              max="100"
              value={endTime}
              step="0.1"
              onInput={(e) => handleEndTimeChange(parseFloat(e.currentTarget.value))}
              onChange={(e) => handleEndTimeChange(parseFloat(e.target.value))}
            />
          </div>

          <div className="trim-preview">
            <strong>Duration:</strong> <span>{formatTime(duration)}</span>
          </div>

          <button onClick={handlePreviewTrim}>👁️ Preview Trim</button>
          <button className="success" onClick={handleTrim}>✂️ Trim & Download</button>
        </div>
      )}

      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>Processing video...</p>
        </div>
      )}

      {showActions && (
        <div className="actions">
          <button onClick={handleDownload}>⬇️ Download Original</button>
          <button className="success" onClick={handleShare}>📤 Share/Save to Photos</button>
          <button onClick={handleClear}>🗑️ Clear</button>
        </div>
      )}
    </div>
  );
}

export default App;
