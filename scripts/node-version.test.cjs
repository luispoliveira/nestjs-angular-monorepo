'use strict';

/**
 * Pins the Node major across `.nvmrc`, root `engines.node` and every app
 * Dockerfile (spec: node-runtime). Run with `pnpm test:deploy`. No
 * dependencies: `node:test` only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const NVMRC = path.join(ROOT, '.nvmrc');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const APPS = path.join(ROOT, 'apps');

const nvmrcMajor = () =>
  Number(fs.readFileSync(NVMRC, 'utf8').trim().replace(/^v/, '').split('.')[0]);

// `engines.node` is a floor (`>=26.0.0`): its major is the lowest line admitted.
const enginesFloor = () => {
  const range = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).engines.node;
  const match = /^>=\s*v?(\d+)/.exec(range);
  assert.ok(match, `engines.node must be a ">=<major>" floor, got "${range}"`);
  return Number(match[1]);
};

const dockerfileMajors = () =>
  fs
    .readdirSync(APPS)
    .map((app) => path.join(APPS, app, 'Dockerfile'))
    .filter((file) => fs.existsSync(file))
    .flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/^FROM node:(\d+)/gm)].map(
        (m) => ({ file: path.relative(ROOT, file), major: Number(m[1]) }),
      ),
    );

test('.nvmrc major equals the engines.node floor', () => {
  assert.equal(nvmrcMajor(), enginesFloor());
});

test('engines.node does not admit an older line than .nvmrc', () => {
  // A floor of N admits N.x and above; 24.22.1 / 22.23.4 must be refused.
  assert.ok(enginesFloor() > 24, 'engines.node still admits Node 24.22.1');
});

test('every Dockerfile node base image is on the .nvmrc major', () => {
  const images = dockerfileMajors();
  assert.ok(images.length > 0, 'no "FROM node:<major>" found in apps/*/Dockerfile');
  for (const { file, major } of images) {
    assert.equal(major, nvmrcMajor(), `${file} uses node:${major}`);
  }
});
