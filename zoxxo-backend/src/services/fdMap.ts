/* eslint-disable @typescript-eslint/no-unused-vars */
type AnyObject = {
  [key: string]: any;
};

type Options = {
  isMutatingOk?: boolean;
  isStrictlySafe?: boolean;
};

function clone<T>(obj: T, isStrictlySafe = false): T {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (err) {
    if (isStrictlySafe) {
      throw new Error(err);
    }
    console.warn(`Unsafe clone of object`, obj);
    return { ...obj };
  }
}

function merge<T>(
  target: T,
  source: AnyObject,
  { isMutatingOk = false, isStrictlySafe = false }: Options = {},
): T {
  const t: any = isMutatingOk ? target : clone(target, isStrictlySafe);
  for (const [key, val] of Object.entries(source)) {
    if (val !== null && typeof val === 'object') {
      if (t[key] === undefined) {
        t[key] = new val.__proto__.constructor();
      }
      t[key] = merge(t[key], val, {
        isMutatingOk: true,
        isStrictlySafe,
      });
    } else {
      t[key] = val;
    }
  }
  return t;
}

export function convertToObject(
  keyString: string,
  value: any,
  parent?: AnyObject,
): AnyObject {
  if (!keyString || keyString.length === 0) {
    throw new Error('"keyString" can not be empty');
  }
  const keys = keyString.split('.').reverse();
  let tempObj: AnyObject;
  keys.forEach((key, index) => {
    const obj: AnyObject = {};
    const isArray = key.includes('[');
    if (isArray) {
      const arrayNotationIndex = key.indexOf('[');
      const keyName = key.slice(0, arrayNotationIndex);
      const arrayNotation = key.slice(arrayNotationIndex);
      const indices: number[] = [];
      let currentIndexStr = '';
      for (let i = 0; i < arrayNotation.length; i += 1) {
        const char = arrayNotation[i];
        if (char === ']') {
          if (isNaN(Number(currentIndexStr))) {
            throw new Error('Invalid index number');
          }
          indices.unshift(Number(currentIndexStr));
          currentIndexStr = '';
        } else if (char === '[') continue;
        else currentIndexStr += char;
      }
      let tempArr: any[] = [];
      for (let j = 0; j < indices.length; j += 1) {
        if (j === 0) {
          tempArr[indices[j]] = tempObj || value;
        } else {
          const parentArr: any[] = [];
          parentArr[indices[j]] = tempArr;
          tempArr = parentArr;
        }
      }
      obj[keyName] = tempArr;
      tempObj = obj;
    } else {
      if (index === 0) {
        obj[key] = value;
        tempObj = obj;
      } else {
        obj[key] = tempObj;
        tempObj = obj;
      }
    }
  });
  return tempObj;
}

export function parse(map: AnyObject): AnyObject {
  const keys = Object.keys(map);
  if (!keys.length) return {};
  let resultObject: AnyObject = {};
  keys.forEach((key) => {
    const res = convertToObject(key, map[key], {});
    resultObject = merge(resultObject, res, {
      isMutatingOk: false,
      isStrictlySafe: true,
    });
  });
  return resultObject;
}
