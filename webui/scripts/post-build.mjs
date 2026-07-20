#!/usr/bin/env node
// Cross-platform post-build cleanup. Equivalent to scripts/post-build.sh but
// works on Windows cmd.exe as well as POSIX shells.
//
// Removes files the adapter-static build leaves behind that we don't want
// shipped inside ../public (they are already inlined into index.html / bundle
// by the vite plugins that run earlier in the build).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', '..', 'public');

const targets = [
	join(publicDir, '_app'),
	join(publicDir, 'favicon.svg'),
	join(publicDir, 'index.html.gz') // deprecated artefact from older builds
];

for (const target of targets) {
	try {
		rmSync(target, { recursive: true, force: true });
	} catch (err) {
		// force:true already swallows ENOENT; surface anything else but never
		// fail the build over cleanup.
		console.warn(`[post-build] skipped ${target}: ${err.message}`);
	}
}
