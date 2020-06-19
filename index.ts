
import { sha256 } from "https://deno.land/x/sha256@v1.0.2/mod.ts";
import { assert } from "https://deno.land/std/testing/asserts.ts";
import { readJson, writeJson } from "https://deno.land/std@0.51.0/fs/mod.ts";

import areas from './areas.ts';

function sha256Hex(input: string): string {
  return sha256(input, "utf8", "hex").toString().toUpperCase();
}

// logic from: http://bmfw.www.gov.cn/yqfxdjcx/source/PC/js/index.js

interface RootParam {
  area_code?: string;
  city_codes?: string[];
  key: string;
}

interface RequestParam extends RootParam {
  appId: string;
  paasHeader: string;
  timestampHeader: string;
  nonceHeader: string;
  signatureHeader: string;
}

function genParam(rootParam: RootParam): RequestParam {
  const param = {
    appId: "NcApplication",
    ...rootParam,
  };
  const timestamp = (new Date().getTime() / 1000).toFixed();
  const token = '23y0ufFl5YxIyGrI8hWRUZmKkvtSjLQA';
  const nonce = '123456789abcdefg';
  const passid = 'zdww';

  return {
    paasHeader: passid,
    timestampHeader: timestamp,
    nonceHeader: nonce,
    signatureHeader: sha256Hex(timestamp + token + nonce + timestamp),
    ...param
  }
}

async function api(param: RequestParam) {
  const timestamp = param.timestampHeader;
  const zdwwsignature = sha256Hex(
    timestamp +
    'fTN2pfuisxTavbTuYVSsNJHetwq5bJvC' +
    'QkjjtiLM2dCratiA' +
    timestamp
  );
  const res = await fetch(
    'http://103.66.32.242:8005/zwfwMovePortal/interface/interfaceJson',
    {
      headers: {
        'x-wif-nonce': 'QkjjtiLM2dCratiA',
        'x-wif-paasid': 'smt-application',
        'x-wif-signature': zdwwsignature,
        'x-wif-timestamp': timestamp,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(param),
      method: 'POST',
    
    });
  return await res.json();
}

interface AreaLevel {
  data: {
    level_code: string
    level_name: string
    end_update_time: string
    county_name: string
   },
   code: number,
   msg: string
}

async function getAreaLevel(areaCode: string): Promise<AreaLevel> {
  const param = genParam({
    area_code: areaCode,
    key: "17487fec8650a09761f93810819abe86",
  });
  return await api(param);
}

interface StreetLevelInfo {
  county_code: string
  county_name: string
  level_code: string
}

interface CityInfoInner {
  city_code: string
  city_name: string
  datas: StreetLevelInfo[]
}

interface CityInfo {
  data: {
    end_update_time: string
    datas: CityInfoInner[]
  }
  code: number
  msg: string
}

async function getCityInfo(cityCode: string): Promise<CityInfo> {
  const param = genParam({
    city_codes: [cityCode],
    key: '8bdd05700ef165746baeca0ae1ef13fc',
  });
  return await api(param);
}

const province = '北京市';

const { city } = areas.filter(({allName}: any) => allName === province)[0];


interface GeoData {
  rows: [{
    GBCODE: string
    center: string
    points: string
    ASCRIPTION: string
    XZQH: string
  }]
}



interface GeoInfo {
  id: string
  center: string
  points: string
  fullName: string
  name: string
}

type GeoMap = {
  [key in string]: GeoInfo
}

const bj = (await readJson('./bj.json')) as GeoData;


const geoMap = bj.rows.reduce<GeoMap>((acc, row) => {
  acc[row.ASCRIPTION] = {
    id: row.GBCODE,
    fullName: row.ASCRIPTION,
    name: row.XZQH,
    center: row.center,
    points: row.points,
  };
  return acc;
}, {});

interface Result {
  id?: string
  cdcName: string
  geoName: string
  updateAt: string
  level: string
  syncAt: number
}

const output: Result[] = [];

const renameMap: {[key in string]: string} = {
  '北京市西城区清河街道': '北京市西城区清河街道（飞地无数据）',
  '北京市朝阳区常营乡': '北京市朝阳区常营回族乡',
  '北京市丰台区方庄街道': '北京市丰台区方庄地区',
  '北京市丰台区宛平城街道': '北京市丰台区宛平城地区',
  '北京市丰台区长辛店镇': '北京市丰台区长辛店街道',
  '北京市丰台区卢沟桥乡': '北京市丰台区卢沟桥街道',
  '北京市丰台区花乡乡': '北京市丰台区花乡',
  '北京市顺义区杨镇镇': '北京市顺义区杨镇',
  '北京市密云区檀营满族蒙族乡': '北京市密云区檀营满族蒙古族乡',
};

for (const cityCode of Object.keys(city)) {
  const cityInfo = await getCityInfo(cityCode);
  assert(cityInfo.code === 0, cityInfo.msg);
  for (const c of cityInfo.data.datas) {
    for (const s of c.datas) {
      const level = await getAreaLevel(s.county_code);
      assert(level.code === 0, level.msg);
      s.county_name = s.county_name.replace(/（.+?）/, '');
      const cdcName = [province, c.city_name, s.county_name].join('');
      let geoName = cdcName;
      if (!!renameMap[geoName]) {
        geoName = renameMap[geoName];
      }
      console.log(cdcName, geoName, level.data.level_name);
      if (level.data.level_name === '低风险') continue;
      const geo = geoMap[geoName];
      output.push({
        id: !!geo ? geo.id : undefined,
        cdcName,
        geoName,
        level: level.data.level_name,
        updateAt: level.data.end_update_time,
        syncAt: Date.now(),
      });
      if (geo) {
        await writeJson(`./geo.${geo.id}.json`, geo);
      }
    }
  }
}

await writeJson('./index.json', output, { spaces: 2 });
