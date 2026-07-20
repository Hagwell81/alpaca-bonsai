import React, { useEffect, useState } from 'react';
import Layout from '@theme/Layout';
import Head from '@docusaurus/Head';

export default function ApiExplorer() {
  const [SwaggerUI, setSwaggerUI] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import('swagger-ui-react'),
    ]).then(([swaggerMod]) => {
      if (!cancelled) {
        setSwaggerUI(() => swaggerMod.default);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!SwaggerUI) {
    return (
      <Layout title="API Explorer" description="Interactive API documentation for Alpacabitollama">
        <Head>
          <link
            rel="stylesheet"
            href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css"
          />
        </Head>
        <main style={{ padding: '2rem', textAlign: 'center' }}>
          <p>Loading API Explorer...</p>
        </main>
      </Layout>
    );
  }

  return (
    <Layout title="API Explorer" description="Interactive API documentation for Alpacabitollama">
      <Head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css"
        />
      </Head>
      <main>
        <style>{`
          .swagger-ui .topbar { display: none; }
          .swagger-ui .info { margin: 20px 0; }
          .swagger-ui { padding: 20px; }
        `}</style>
        <SwaggerUI url="/openapi.json" />
      </main>
    </Layout>
  );
}
