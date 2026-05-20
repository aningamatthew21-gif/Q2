import React from 'react';

/**
 * SceneErrorBoundary — never let the 3D scene crash the whole page.
 *
 * The cinematic Scene depends on WebGL, the postprocessing pipeline,
 * and the drei Environment loader. Any one of those can fail on:
 *   - older Android Chromium without WebGL2
 *   - corporate proxies that block the drei CDN HDRI
 *   - sandboxed WebViews
 *   - hardware-acceleration-disabled browsers
 *
 * When it fails we don't want the whole login page to vanish — we render
 * a static gradient fallback so the login card stays usable. The error
 * is logged to the console for diagnosis but the user never knows.
 */
export default class SceneErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[LoginCinematic] Scene crashed — falling back to static gradient.', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(circle at 30% 50%, #143a72 0%, #06122a 60%, #050b1a 100%)'
          }}
          aria-hidden="true"
        />
      );
    }
    return this.props.children;
  }
}
