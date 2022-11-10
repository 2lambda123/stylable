import { expect } from 'chai';
import { Stylable } from '@stylable/core';
import { build } from '@stylable/cli';
import { createMemoryFs } from '@file-services/memory';
import { DiagnosticsManager } from '@stylable/cli/dist/diagnostics-manager';
import { STImport, STVar } from '@stylable/core/dist/features';
import { processorDiagnostics, murmurhash3_32_gc } from '@stylable/core/dist/index-internal';
import { diagnosticBankReportToStrings } from '@stylable/core-test-kit';

const stImportDiagnostics = diagnosticBankReportToStrings(STImport.diagnostics);
const stVarDiagnostics = diagnosticBankReportToStrings(STVar.diagnostics);
const processorStringDiagnostics = diagnosticBankReportToStrings(processorDiagnostics);

const log = () => {
    /**/
};

describe('build stand alone', () => {
    it('should create modules and copy source css files', async () => {
        const fs = createMemoryFs({
            '/main.st.css': `
                :import{
                    -st-from: "./components/comp.st.css";
                    -st-default:Comp;
                }
                .gaga{
                    -st-extends:Comp;
                    color:blue;
                }
            `,
            '/components/comp.st.css': `
                .baga{
                    color:red;
                }
            `,
        });

        const stylable = new Stylable({
            projectRoot: '/',
            fileSystem: fs,
            requireModule: () => ({}),
        });

        await build(
            {
                outDir: 'lib',
                srcDir: '.',
                cjs: true,
                outputSources: true,
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
            }
        );

        [
            '/lib/main.st.css',
            '/lib/main.st.css.js',
            '/lib/components/comp.st.css',
            '/lib/components/comp.st.css.js',
        ].forEach((p) => {
            expect(fs.existsSync(p), p).to.equal(true);
        });

        // assure no index file was generated by default
        expect(fs.existsSync('/lib/index.st.css'), '/lib/index.st.css').to.equal(false);
    });

    it('should use "useNamespaceReference" to maintain a single namespace for all builds using it', async () => {
        const fs = createMemoryFs({
            '/src/main.st.css': `
                :import{
                    -st-from: "./components/comp.st.css";
                    -st-default:Comp;
                }
                .gaga{
                    -st-extends:Comp;
                    color:blue;
                }
            `,
            '/src/components/comp.st.css': `
                .baga{
                    color:red;
                }
            `,
        });

        const stylable = new Stylable({
            projectRoot: '/',
            fileSystem: fs,
            resolveNamespace(n, s) {
                const normalizedWindowsRoot = fs.relative(
                    '/',
                    s.replace(/^\w:\\/, '/').replace('\\', '/')
                );
                return n + murmurhash3_32_gc(normalizedWindowsRoot);
            },
        });

        await build(
            {
                srcDir: 'src',
                outDir: 'cjs',
                cjs: true,
                outputSources: true,
                useNamespaceReference: true,
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
            }
        );

        [
            '/cjs/main.st.css',
            '/cjs/main.st.css.js',
            '/cjs/components/comp.st.css',
            '/cjs/components/comp.st.css.js',
        ].forEach((p) => {
            expect(fs.existsSync(p), p).to.equal(true);
        });

        expect(fs.readFileSync('/cjs/main.st.css', 'utf-8')).to.include(
            'st-namespace-reference="../src/main.st.css"'
        );

        await build(
            {
                srcDir: 'cjs',
                outDir: 'cjs2',
                cjs: true,
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
            }
        );

        // check two builds using sourceNamespace are identical
        // compare two serializable js modules including their namespace
        expect(fs.readFileSync('/cjs/main.st.css.js', 'utf-8')).to.equal(
            fs.readFileSync('/cjs2/main.st.css.js', 'utf-8')
        );
    });

    it('should report errors originating from stylable (process + transform)', async () => {
        const identifier = 'build-identifier';
        const fs = createMemoryFs({
            '/comp.st.css': `
                :import {
                    -st-from: "./missing-file.st.css";
                    -st-default: OtherMissingComp;
                }

                .a {
                    -st-extends: MissingComp;
                    color: value(missingVar);
                }
            `,
        });

        const stylable = new Stylable({
            projectRoot: '/',
            fileSystem: fs,
            requireModule: () => ({}),
        });
        const diagnosticsManager = new DiagnosticsManager();

        await build(
            {
                outDir: '.',
                srcDir: '.',
                cjs: true,
                diagnostics: true,
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
                diagnosticsManager,
                identifier,
            }
        );
        const messages = diagnosticsManager.get(identifier, '/comp.st.css')!.diagnostics;

        expect(messages[0].message).to.contain(
            processorStringDiagnostics.CANNOT_RESOLVE_EXTEND('MissingComp')
        );
        expect(messages[1].message).to.contain(
            stImportDiagnostics.UNKNOWN_IMPORTED_FILE('./missing-file.st.css')
        );
        expect(messages[2].message).to.contain(stVarDiagnostics.UNKNOWN_VAR('missingVar'));
    });

    it('should optimize css (remove empty nodes, remove stylable-directives, remove comments)', async () => {
        const fs = createMemoryFs({
            '/comp.st.css': `
                .root {
                    color: red;
                }
                /* comment */
                .x {
                    
                }
            `,
        });

        const stylable = new Stylable({
            projectRoot: '/',
            fileSystem: fs,
            requireModule: () => ({}),
        });

        await build(
            {
                outDir: './dist',
                srcDir: '.',
                cjs: true,
                outputCSS: true,
                outputCSSNameTemplate: '[filename].global.css',
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
            }
        );

        const builtFile = fs.readFileSync('/dist/comp.global.css', 'utf8');

        expect(builtFile).to.contain(`root {`);
        expect(builtFile).to.contain(`color: red;`);
        expect(builtFile).to.not.contain(`.x`);
    });

    it('should minify', async () => {
        const fs = createMemoryFs({
            '/comp.st.css': `
                .root {
                    color: rgb(255,0,0);
                }
            `,
        });

        const stylable = new Stylable({
            projectRoot: '/',
            fileSystem: fs,
            resolveNamespace() {
                return 'test';
            },
        });

        await build(
            {
                outDir: './dist',
                srcDir: '.',
                minify: true,
                cjs: true,
                outputCSS: true,
                outputCSSNameTemplate: '[filename].global.css',
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
            }
        );

        const builtFile = fs.readFileSync('/dist/comp.global.css', 'utf8');

        expect(builtFile).to.contain(`.test__root{color:red}`);
    });

    it('inline runtime', async () => {
        const fs = createMemoryFs({
            '/comp.st.css': `
                .root {
                    color: rgb(255,0,0);
                }
            `,
            '/node_modules/@stylable/runtime/dist/index.js': `// runtime cjs`,
            '/node_modules/@stylable/runtime/esm/index.js': `// runtime esm`,
        });

        const stylable = new Stylable({
            projectRoot: '/',
            fileSystem: fs,
            resolveNamespace() {
                return 'test';
            },
        });

        await build(
            {
                outDir: './dist',
                srcDir: '.',
                cjs: true,
                esm: true,
                inlineRuntime: true,
                runtimeCjsRequest: '/node_modules/@stylable/runtime/dist/index.js',
                runtimeEsmRequest: '/node_modules/@stylable/runtime/esm/index.js',
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
            }
        );

        const builtFileEsm = fs.readFileSync('/dist/comp.st.css.mjs', 'utf8');
        const builtFileCjs = fs.readFileSync('/dist/comp.st.css.js', 'utf8');

        // this makes sure that we actually copied the runtime
        const runtimeCjs = fs.readFileSync('/dist/runtime.js', 'utf8');
        const runtimeMjs = fs.readFileSync('/dist/runtime.mjs', 'utf8');

        expect(builtFileEsm, 'imports the esm runtime').to.contain(`./runtime.mjs`);
        expect(builtFileCjs, 'imports the cjs runtime').to.contain(`./runtime.js`);
        expect(runtimeCjs).to.eql(`// runtime cjs`);
        expect(runtimeMjs).to.eql(`// runtime esm`);
    });

    it('should inject request to output module', async () => {
        const fs = createMemoryFs({
            '/comp.st.css': `
                .root {
                    color: red;
                }
            `,
        });

        const stylable = new Stylable({
            projectRoot: '/',
            fileSystem: fs,
            requireModule: () => ({}),
        });

        await build(
            {
                outDir: './dist',
                srcDir: '.',
                cjs: true,
                esm: true,
                outputCSS: true,
                injectCSSRequest: true,
                outputCSSNameTemplate: '[filename].global.css',
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
            }
        );

        expect(fs.readFileSync('/dist/comp.st.css.js', 'utf8')).contains(
            `require("./comp.global.css")`
        );
        expect(fs.readFileSync('/dist/comp.st.css.mjs', 'utf8')).contains(
            `import "./comp.global.css"`
        );
        expect(fs.existsSync('/dist/comp.global.css')).to.equal(true);
    });

    it('DTS only parts', async () => {
        const fs = createMemoryFs({
            '/main.st.css': `
                .root   {}
                .part {}`,
        });

        const stylable = new Stylable({
            projectRoot: '/',
            fileSystem: fs,
            requireModule: () => ({}),
        });

        await build(
            {
                outDir: '.',
                srcDir: '.',
                dts: true,
                dtsSourceMap: false,
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
            }
        );

        ['/main.st.css', '/main.st.css.d.ts'].forEach((p) => {
            expect(fs.existsSync(p), p).to.equal(true);
        });

        const dtsContent = fs.readFileSync('/main.st.css.d.ts', 'utf8');

        expect(dtsContent).contains('declare const classes');
        expect(dtsContent).contains('"root":');
        expect(dtsContent).contains('"part":');
    });

    it('DTS with states', async () => {
        const fs = createMemoryFs({
            '/main.st.css': `
                .root   { -st-states: w; }
                .string { -st-states: x(string); }
                .number { -st-states: y(number); }
                .enum   { -st-states: z(enum(on, off, default)); }`,
        });

        const stylable = new Stylable({
            projectRoot: '/',
            fileSystem: fs,
            requireModule: () => ({}),
        });

        await build(
            {
                outDir: '.',
                srcDir: '.',
                dts: true,
                dtsSourceMap: false,
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
            }
        );

        ['/main.st.css', '/main.st.css.d.ts'].forEach((p) => {
            expect(fs.existsSync(p), p).to.equal(true);
        });

        const dtsContent = fs.readFileSync('/main.st.css.d.ts', 'utf8');

        expect(dtsContent).to.contain('type states = {');
        expect(dtsContent).to.contain('"w"?:');
        expect(dtsContent).to.contain('"x"?: string');
        expect(dtsContent).to.contain('"y"?: number');
        expect(dtsContent).to.contain('"z"?: "on" | "off" | "default";');
    });

    it('DTS with mapping', async () => {
        const fs = createMemoryFs({
            '/main.st.css': `
                @keyframes blah {
                    0% {}
                    100% {}
                }
                :vars {
                    v1: red;
                    v2: green;
                }
                .root   { 
                    -st-states: a, b, w;
                    --c1: red;
                    --c2: green;
                 }
                .string { -st-states: x(string); }
                .number { -st-states: y(number); }
                .enum   { -st-states: z(enum(on, off, default)); }`,
        });

        const stylable = new Stylable({
            projectRoot: '/',
            fileSystem: fs,
            requireModule: () => ({}),
        });

        await build(
            {
                outDir: '.',
                srcDir: '.',
                dts: true,
                dtsSourceMap: true,
            },
            {
                fs,
                stylable,
                rootDir: '/',
                projectRoot: '/',
                log,
            }
        );

        ['/main.st.css', '/main.st.css.d.ts', '/main.st.css.d.ts.map'].forEach((p) => {
            expect(fs.existsSync(p), p).to.equal(true);
        });

        const dtsSourceMapContent = fs.readFileSync('/main.st.css.d.ts.map', 'utf8');
        expect(dtsSourceMapContent).to.contain(`"file": "main.st.css.d.ts",`);
        expect(dtsSourceMapContent).to.contain(`"sources": [`);
        expect(dtsSourceMapContent).to.contain(`"main.st.css"`);
    });
});
