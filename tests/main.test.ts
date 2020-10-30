import path from 'path';
import {} from 'ts-expose-internals';
import TS from 'typescript';

import {createProgram, EmittedFiles, getEmitResult, getExpected} from './helpers';

const fixituresPath = path.resolve(__dirname, 'fixtures');

describe('Transformer', () => {
  let tsConfigFile = path.resolve(fixituresPath, 'tsconfig.json');
  let programForCjs = createProgram(
    tsConfigFile,
    false,
    {module: TS.ModuleKind.CommonJS, target: TS.ScriptTarget.ES5},
    {extensions: {'.ts': '.js'}}
  );
  let programForEsm = createProgram(
    tsConfigFile,
    false,
    {module: TS.ModuleKind.ES2020, target: TS.ScriptTarget.ES2020},
    {extensions: {'.ts': '.js'}}
  );
  let expected: {[fileName: string]: string};
  let transformedCjsFiles: EmittedFiles = {};
  let transformedEsmFiles: EmittedFiles = {};

  beforeAll(async () => {
    expected = await getExpected();
    transformedCjsFiles = getEmitResult(programForCjs);
    transformedEsmFiles = getEmitResult(programForEsm);
  });

  describe('CJS', () => {
    test('when no file extension is given in the import', () => {
      expect(transformedCjsFiles['main.ts'].js).toBe(expected['main.cjs']);
    });
  });

  describe('ESM', () => {
    test('when no file extension is given in the import', () => {
      expect(transformedEsmFiles['main.ts'].js).toBe(expected['main.esm']);
    });
  });
});
