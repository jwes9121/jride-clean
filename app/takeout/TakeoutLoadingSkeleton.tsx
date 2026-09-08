export default function TakeoutLoadingSkeleton() {
  return (
    <div className="jride-takeout-loading" role="status" aria-label="Loading JRide Takeout" aria-busy="true">
      <div className="jride-takeout-loading-brand">JRIDE TAKEOUT</div>
      <p>Getting Takeout ready...</p>
      <div aria-hidden="true" className="jride-takeout-loading-shapes">
        <div className="jride-takeout-loading-line" />
        <div className="jride-takeout-loading-towns">
          {[0, 1, 2, 3].map((item) => <div key={item} />)}
        </div>
        <div className="jride-takeout-loading-line" />
        {[0, 1, 2].map((item) => <div className="jride-takeout-loading-store" key={item} />)}
      </div>
    </div>
  );
}
