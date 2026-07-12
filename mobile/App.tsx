/**
 * 모바일 앱 (Expo / React Native)
 *
 * 웹과 완전히 동일한 FastAPI 를 호출한다. 백엔드는 하나만 유지한다.
 *
 * 실행:
 *   npx create-expo-app@latest mobile --template blank-typescript
 *   이 파일로 App.tsx 를 덮어쓰고
 *   npx expo start   → 폰에서 Expo Go 앱으로 QR 스캔
 *
 * 보안: API 키를 앱 번들에 넣으면 리버싱으로 추출 가능하다.
 *   개인용이라면 expo-secure-store 에 저장 후 최초 1회 입력받는 방식이 안전하다.
 *   (아래는 SecureStore 를 사용한 형태)
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, SafeAreaView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';

const API_BASE = 'https://your-app.vercel.app/api/py';
const C = { ink: '#10151F', card: '#1A2233', line: '#263047', fog: '#8A97AE', chalk: '#E9EDF5', lamp: '#F5A524' };

type Summary = {
  period_start: string; total_distance_km: number; total_calories: number;
  avg_pace_label: string; duration_label: string; activity_count: number;
};
type Activity = {
  activity_id: number; activity_name: string; start_time_local: string;
  distance_km: number; calories: number; avg_pace_label: string; duration_label: string;
};

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [week, setWeek] = useState<Summary | null>(null);
  const [month, setMonth] = useState<Summary | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { SecureStore.getItemAsync('dashboard_api_key').then(setApiKey); }, []);

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    setError(null);
    try {
      const opts = { headers: { 'X-API-Key': apiKey } };
      const [w, m, a] = await Promise.all([
        fetch(`${API_BASE}/summary/weekly?weeks=1`, opts),
        fetch(`${API_BASE}/summary/monthly?months=1`, opts),
        fetch(`${API_BASE}/activities?limit=15`, opts),
      ]);
      if (w.status === 401) throw new Error('API 키가 올바르지 않습니다.');
      setWeek((await w.json())[0] ?? null);
      setMonth((await m.json())[0] ?? null);
      setActs(await a.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => { load(); }, [load]);

  if (!apiKey) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.gate}>
          <Text style={s.h1}>러닝 대시보드</Text>
          <Text style={s.fog}>API 키를 한 번만 입력하면 기기에 안전하게 보관됩니다.</Text>
          <TextInput
            style={s.input} value={keyInput} onChangeText={setKeyInput}
            placeholder="API 키" placeholderTextColor={C.fog} secureTextEntry autoCapitalize="none"
          />
          <TouchableOpacity
            style={s.btn}
            onPress={async () => {
              await SecureStore.setItemAsync('dashboard_api_key', keyInput.trim());
              setApiKey(keyInput.trim());
            }}
          >
            <Text style={s.btnText}>저장하고 시작</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const Cards = ({ title, d }: { title: string; d: Summary | null }) => (
    <View style={{ marginBottom: 24 }}>
      <Text style={s.h2}>{title}</Text>
      <View style={s.row}>
        <Stat label="누적 거리" value={`${(d?.total_distance_km ?? 0).toFixed(1)}`} unit="km" />
        <Stat label="누적 시간" value={d?.duration_label ?? '0:00:00'} />
      </View>
      <View style={s.row}>
        <Stat label="칼로리" value={`${d?.total_calories ?? 0}`} unit="kcal" />
        <Stat label="평균 페이스" value={d?.avg_pace_label ?? '-'} unit="/km" />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.screen}>
      <FlatList
        contentContainerStyle={{ padding: 20 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.lamp} />}
        ListHeaderComponent={
          <>
            <Text style={s.h1}>러닝 대시보드</Text>
            {error ? <Text style={s.error}>{error}</Text> : null}
            {loading && !week ? <ActivityIndicator color={C.lamp} style={{ marginVertical: 24 }} /> : null}
            <Cards title="이번 주" d={week} />
            <Cards title="이번 달" d={month} />
            <Text style={s.h2}>최근 활동</Text>
          </>
        }
        data={acts}
        keyExtractor={(a) => String(a.activity_id)}
        ListEmptyComponent={<Text style={s.fog}>동기화된 활동이 없습니다.</Text>}
        renderItem={({ item }) => (
          <View style={s.act}>
            <View style={{ flex: 1 }}>
              <Text style={s.actName}>{item.activity_name}</Text>
              <Text style={s.actSub}>{item.start_time_local.replace('T', ' ').slice(0, 16)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.actKm}>{item.distance_km.toFixed(2)} km</Text>
              <Text style={s.actSub}>{item.avg_pace_label}/km · {item.duration_label}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={s.card}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>
        {value}
        {unit ? <Text style={s.unit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ink },
  gate: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  h1: { color: C.chalk, fontSize: 30, fontWeight: '700', marginBottom: 16 },
  h2: { color: C.chalk, fontSize: 16, fontWeight: '600', marginBottom: 10, letterSpacing: 1 },
  fog: { color: C.fog, fontSize: 13 },
  error: { color: C.lamp, fontSize: 13, marginBottom: 12 },
  input: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 6,
           color: C.chalk, padding: 14, fontSize: 15 },
  btn: { backgroundColor: C.lamp, borderRadius: 6, padding: 15, alignItems: 'center' },
  btnText: { color: C.ink, fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  card: { flex: 1, backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
          borderRadius: 6, padding: 14 },
  label: { color: C.fog, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  value: { color: C.chalk, fontSize: 26, fontWeight: '700', marginTop: 4 },
  unit: { color: C.fog, fontSize: 13, fontWeight: '500' },
  act: { flexDirection: 'row', paddingVertical: 14, borderTopColor: C.line, borderTopWidth: 1 },
  actName: { color: C.chalk, fontSize: 15, fontWeight: '600' },
  actSub: { color: C.fog, fontSize: 11, marginTop: 3 },
  actKm: { color: C.lamp, fontSize: 15, fontWeight: '700' },
});
