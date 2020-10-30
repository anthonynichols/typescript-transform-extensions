import fs from 'fs/promises';
import path from 'path';
import ts from 'ttypescript';
import {TsTransformExtensionsConfig} from '../src/main';

import type * as TS from 'typescript';

export function createProgram(
  tsConfigFile: string,
  disablePlugin?: boolean,
  additionalOptions?: TS.CompilerOptions,
  pluginOptions?: TsTransformExtensionsConfig
): TS.Program;
export function createProgram(
  files: Files,
  disablePlugin?: boolean,
  additionalOptions?: TS.CompilerOptions,
  pluginOptions?: TsTransformExtensionsConfig
): TS.Program;
export function createProgram(
  configOrFiles: string | Files,
  disablePlugin?: boolean,
  additionalOptions?: TS.CompilerOptions,
  pluginOptions?: TsTransformExtensionsConfig
): TS.Program {
  let transformerPath = path.resolve(__dirname, '../src/main.ts');
  let configOptions = Object.assign({}, additionalOptions, {
    outDir: undefined,
    noEmit: false,
    plugins: disablePlugin ? [] : [{transform: transformerPath, ...pluginOptions}],
  });
  let options: any = {};
  let fileNames: string[];
  let host: TS.CompilerHost | undefined;

  if (typeof configOrFiles === 'string') {
    let pcl = ts.getParsedCommandLineOfConfigFile(configOrFiles, configOptions, <any>ts.sys)!;
    options = pcl.options;
    fileNames = pcl.fileNames;
  } else {
    let files = Object.entries(configOrFiles).reduce((_path, [fileName, data]) => {
      let normalizedPath = ts.normalizePath(fileName);
      _path[normalizedPath] = data;

      return _path;
    }, <any>{});
    fileNames = Object.keys(files);
    host = ts.createCompilerHost(options);
    options = configOptions;

    // - Patch host to feed mock files
    let originalGetSourceFile: any = host.getSourceFile;
    host.getSourceFile = function (fileName: string, scriptTarget: TS.ScriptTarget) {
      if (Object.keys(files).includes(fileName)) {
        return ts.createSourceFile(fileName, files[fileName], scriptTarget);
      } else {
        originalGetSourceFile.apply(undefined, arguments);
      }
    };
  }

  return ts.createProgram({options, rootNames: fileNames, host});
}

type File = string;
type Files = {[fileName: string]: File};
type EmittedFile = {
  js: File;
  dts: File;
};
export type EmittedFiles = {[fileName: string]: EmittedFile};

export function getEmitResult(program: TS.Program): EmittedFiles {
  let outputFiles: EmittedFiles = {};
  let writeFile = (fileName: string, data: string) => {
    let {1: rootName, 2: ext} = fileName.match(/(.+)\.((d.ts)|(js))$/) ?? [];

    if (!ext) return;

    let key = ext.replace('.', '') as keyof EmittedFiles[string];

    rootName = `${path.parse(rootName).name}.ts`;

    if (!outputFiles[rootName]) outputFiles[rootName] = <any>{};

    outputFiles[rootName][key] = data;
  };

  program.emit(undefined, writeFile);

  return outputFiles;
}

export async function getExpected() {
  type Expected = {[fileName: string]: string};
  let expected: Expected = {};
  let expectedDir = path.resolve(__dirname, 'expected');
  let expectedFiles = await fs.readdir(expectedDir);

  for (let file of expectedFiles) {
    let fileName = path.parse(file).name;
    let fileData = (await fs.readFile(path.resolve(expectedDir, file))).toString();

    expected[fileName] = fileData;
  }

  return expected;
}
