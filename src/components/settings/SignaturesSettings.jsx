import React, { useState, useEffect, useRef } from 'react';
import api from '../../api';
import Icon from '../common/Icon';
import Notification from '../common/Notification';
import { useActivityLog } from '../../hooks/useActivityLog';

const SignaturesSettings = ({ userId }) => {
    const { log } = useActivityLog();
    const [signatures, setSignatures] = useState([]);
    const [newSignature, setNewSignature] = useState({
        controllerName: '',
        subsidiary: '',
        signatureFile: null,
        signatureDataUrl: null
    });
    const [signatureTab, setSignatureTab] = useState('upload');
    const [signaturesLoading, setSignaturesLoading] = useState(true);
    const [notification, setNotification] = useState(null);
    const signatureCanvasRef = useRef(null);

    // No longer using Firestore refs
    // const signaturesDocRef = doc(db, `artifacts/${appId}/public/data/settings`, 'signatures');

    // Load signatures and filter by CURRENT USER
    useEffect(() => {
        const fetchSignatures = async () => {
            try {
                const response = await api.get('/settings/signatures');
                if (response.success && response.data) {
                    const allSignatures = response.data.signatures || [];
                    const mySignatures = allSignatures.filter(sig => sig.createdBy === userId);
                    setSignatures(mySignatures);
                }
                setSignaturesLoading(false);
            } catch (err) {
                console.error('Error fetching signatures:', err);
                setSignaturesLoading(false);
            }
        };
        fetchSignatures();
    }, [userId]);

    // Setup canvas drawing with proper DPI scaling
    useEffect(() => {
        console.log('🔍 [DEBUG] Canvas setup useEffect triggered', {
            signatureTab,
            canvasRef: !!signatureCanvasRef.current
        });

        if (signatureTab !== 'draw') {
            console.log('📱 [DEBUG] Canvas setup skipped - not on draw tab');
            return;
        }

        const canvas = signatureCanvasRef.current;
        if (!canvas) {
            console.warn('⚠️ [DEBUG] Canvas not available for setup - will retry on next render');
            return;
        }

        const setupCanvas = () => {
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            console.log('🎨 [DEBUG] Setting up canvas with DPI scaling', {
                displayWidth: rect.width,
                displayHeight: rect.height,
                devicePixelRatio: dpr
            });

            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;

            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);

            canvas.style.width = rect.width + 'px';
            canvas.style.height = rect.height + 'px';

            console.log('✅ [DEBUG] Canvas setup complete:', {
                displaySize: { width: rect.width, height: rect.height },
                internalSize: { width: canvas.width, height: canvas.height },
                devicePixelRatio: dpr
            });
        };

        const ctx = canvas.getContext('2d');
        setupCanvas();
        window.addEventListener('resize', setupCanvas);

        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;

        const getCoordinates = (e) => {
            const rect = canvas.getBoundingClientRect();
            let clientX, clientY;

            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else if (e.changedTouches && e.changedTouches.length > 0) {
                clientX = e.changedTouches[0].clientX;
                clientY = e.changedTouches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }

            const x = (clientX - rect.left);
            const y = (clientY - rect.top);

            return { x, y };
        };

        const startDrawing = (e) => {
            isDrawing = true;
            const coords = getCoordinates(e);
            lastX = coords.x;
            lastY = coords.y;
        };

        const draw = (e) => {
            if (!isDrawing) return;

            const coords = getCoordinates(e);
            const currentX = coords.x;
            const currentY = coords.y;

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(currentX, currentY);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            lastX = currentX;
            lastY = currentY;
        };

        const stopDrawing = () => {
            isDrawing = false;
        };

        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);

        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            isDrawing = true;
            const coords = getCoordinates(e);
            lastX = coords.x;
            lastY = coords.y;
        });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!isDrawing) return;

            const coords = getCoordinates(e);
            const currentX = coords.x;
            const currentY = coords.y;

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(currentX, currentY);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            lastX = currentX;
            lastY = currentY;
        });

        canvas.addEventListener('touchend', stopDrawing);

        return () => {
            window.removeEventListener('resize', setupCanvas);
            canvas.removeEventListener('mousedown', startDrawing);
            canvas.removeEventListener('mousemove', draw);
            canvas.removeEventListener('mouseup', stopDrawing);
            canvas.removeEventListener('mouseout', stopDrawing);
            canvas.removeEventListener('touchstart', startDrawing);
            canvas.removeEventListener('touchmove', draw);
            canvas.removeEventListener('touchend', stopDrawing);
        };
    }, [signatureTab]);

    const handleSignatureFileUpload = (event) => {
        const file = event.target.files[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) return setNotification({ type: 'error', message: 'File too large (>2MB)' });
            setNewSignature(prev => ({ ...prev, signatureFile: file, signatureDataUrl: null }));
        }
    };

    const handleSaveSignature = async () => {
        try {
            if (!newSignature.controllerName || !newSignature.subsidiary) {
                return setNotification({ type: 'error', message: 'Fill required fields' });
            }

            let signatureData = newSignature.signatureDataUrl;
            if (newSignature.signatureFile) {
                const reader = new FileReader();
                signatureData = await new Promise((resolve) => {
                    reader.onload = () => resolve(reader.result);
                    reader.readAsDataURL(newSignature.signatureFile);
                });
            }

            if (!signatureData) return setNotification({ type: 'error', message: 'No signature provided' });

            // 1. Fetch CURRENT FULL LIST
            const res = await api.get('/settings/signatures');
            const currentList = res.success && res.data ? res.data.signatures || [] : [];

            const signatureObj = {
                id: Date.now().toString(), // Critical for deletion
                controllerName: newSignature.controllerName,
                subsidiary: newSignature.subsidiary,
                signatureUrl: signatureData,
                createdAt: new Date().toISOString(),
                createdBy: userId // Critical for security
            };

            const updatedSignatures = [...currentList, signatureObj];
            await api.post('/settings/signatures', { signatures: updatedSignatures });
            
            // Update local state (filtered)
            setSignatures(prev => [...prev, signatureObj]);

            setNewSignature({ controllerName: '', subsidiary: '', signatureFile: null, signatureDataUrl: null });
            setNotification({ type: 'success', message: 'Signature saved securely.' });

        } catch (error) {
            console.error(error);
            setNotification({ type: 'error', message: 'Failed to save.' });
        }
    };

    // FIXED DELETION LOGIC
    const handleDeleteSignature = async (signatureId) => {
        if (!window.confirm("Delete this signature? This cannot be undone.")) return;

        try {
            // 1. Fetch FULL list first
            const res = await api.get('/settings/signatures');
            const allSignatures = res.success && res.data ? res.data.signatures || [] : [];

            // 2. Filter out the specific ID
            const updatedSignatures = allSignatures.filter(s => s.id !== signatureId);

            // 3. Save back
            await api.post('/settings/signatures', { signatures: updatedSignatures });
            
            // Update local state
            setSignatures(prev => prev.filter(s => s.id !== signatureId));

            setNotification({ type: 'success', message: 'Signature deleted.' });
        } catch (error) {
            console.error("Delete failed:", error);
            setNotification({ type: 'error', message: 'Delete failed.' });
        }
    };

    const clearSignatureCanvas = () => {
        const canvas = signatureCanvasRef.current;
        if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    };

    const saveSignatureFromCanvas = () => {
        const canvas = signatureCanvasRef.current;
        if (canvas) {
            setNewSignature(prev => ({ ...prev, signatureDataUrl: canvas.toDataURL('image/png') }));
            setNotification({ type: 'success', message: 'Drawing captured! Click "Save Signature".' });
        }
    };

    return (
        <div className="bg-white p-6 rounded-xl shadow-md max-w-4xl mx-auto">
            {notification && <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />}
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-700">Digital Signature Management</h2>
            </div>

            {/* LIST SECTION */}
            <div className="space-y-6 mb-8">
                <h3 className="text-lg font-medium text-gray-700">My Signatures</h3>
                {signaturesLoading ? <div>Loading...</div> : signatures.length === 0 ? (
                    <div className="text-center text-gray-500 py-4">You haven't uploaded any signatures yet.</div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {signatures.map((sig) => (
                            <div key={sig.id} className="border rounded-lg p-4 bg-gray-50 relative group">
                                <button
                                    onClick={() => handleDeleteSignature(sig.id)}
                                    className="absolute top-2 right-2 text-red-400 hover:text-red-600 p-1 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Delete Signature"
                                >
                                    <Icon id="trash-alt" className="w-4 h-4" />
                                </button>
                                <div className="text-center mb-2">
                                    <img src={sig.signatureUrl} alt="Sig" className="h-16 mx-auto object-contain" />
                                </div>
                                <div className="text-sm text-center font-medium">{sig.controllerName}</div>
                                <div className="text-xs text-center text-gray-500">{sig.subsidiary}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ADD SECTION (Simplified for brevity, same fields as before) */}
            <div className="border-t pt-6">
                <h3 className="text-lg font-medium text-gray-700 mb-4">Add New Signature</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <input
                        className="p-3 border rounded"
                        placeholder="Controller Name"
                        value={newSignature.controllerName}
                        onChange={e => setNewSignature({ ...newSignature, controllerName: e.target.value })}
                    />
                    <select
                        className="p-3 border rounded"
                        value={newSignature.subsidiary}
                        onChange={e => setNewSignature({ ...newSignature, subsidiary: e.target.value })}
                    >
                        <option value="">Select Subsidiary...</option>
                        <option value="MIDSA">MIDSA</option>
                        <option value="ICPS">ICPS</option>
                        <option value="IMS">IMS</option>
                    </select>
                </div>

                {/* TABS */}
                <div className="flex space-x-4 mb-4 border-b">
                    <button onClick={() => setSignatureTab('upload')} className={`pb-2 ${signatureTab === 'upload' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}`}>Upload</button>
                    <button onClick={() => setSignatureTab('draw')} className={`pb-2 ${signatureTab === 'draw' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}`}>Draw</button>
                </div>

                {signatureTab === 'upload' ? (
                    <input type="file" accept="image/*" onChange={handleSignatureFileUpload} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                ) : (
                    <div>
                        <div className="border border-gray-300 rounded bg-white"><canvas ref={signatureCanvasRef} style={{ height: '150px', width: '100%', touchAction: 'none' }} /></div>
                        <div className="flex space-x-2 mt-2">
                            <button onClick={clearSignatureCanvas} className="px-3 py-1 bg-gray-200 rounded text-sm">Clear</button>
                            <button onClick={saveSignatureFromCanvas} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Capture</button>
                        </div>
                    </div>
                )}

                <button onClick={handleSaveSignature} className="w-full mt-6 bg-green-600 text-white py-3 rounded hover:bg-green-700">Save Signature</button>
            </div>
        </div>
    );
};

export default SignaturesSettings;
