#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);

const int pressurePin = A0;
const unsigned long sampleIntervalMs = 2;
const unsigned long displayIntervalMs = 200;
const int sampleCount = 20;

unsigned long lastSampleTime = 0;
unsigned long lastDisplayTime = 0;
long sampleSum = 0;
int samplesCollected = 0;
float pressureBar = 0;
bool pressureReady = false;

void setup() {
  Serial.begin(115200);

  lcd.init();
  lcd.backlight();

  lcd.setCursor(0, 0);
  lcd.print("Pressure (bar)");
  lcd.setCursor(0, 1);
  lcd.print("Measuring...");
}

float calculatePressureBar(float raw) {
  // 기존 5V / 10비트 ADC와 센서 보정값 유지
  float voltage = raw * 5.0 / 1023.0;

  const float zeroVoltage = 0.90;
  const float resistorOhm = 249.0;
  const float maxBar = 30.0;

  float spanVoltage = 0.016 * resistorOhm;
  float pressureBar = (voltage - zeroVoltage) * maxBar / spanVoltage;

  // 무압 상태 보정
  pressureBar -= 0.8;

  if (pressureBar < 0) {
    pressureBar = 0;
  }

  return pressureBar;
}

void loop() {
  unsigned long now = millis();

  // 대기 없이 2ms 간격으로 읽고 20개씩 평균: 압력값 약 초당 25회 갱신
  if (now - lastSampleTime >= sampleIntervalMs) {
    lastSampleTime = now;
    sampleSum += analogRead(pressurePin);
    samplesCollected++;

    if (samplesCollected == sampleCount) {
      pressureBar = calculatePressureBar(sampleSum / float(sampleCount));
      pressureReady = true;
      sampleSum = 0;
      samplesCollected = 0;
    }
  }

  // LCD와 시리얼 출력은 초당 5회로 제한
  if (!pressureReady || now - lastDisplayTime < displayIntervalMs) return;
  lastDisplayTime = now;

  lcd.setCursor(0, 1);
  lcd.print(pressureBar, 2);
  lcd.print("          "); // 이전 측정값의 남은 자릿수 지우기

  Serial.println(pressureBar, 2);
}
