#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);

const int pressurePin = A0;

void setup() {
  Serial.begin(115200);

  lcd.init();
  lcd.backlight();

  lcd.setCursor(0, 0);
  lcd.print("Pressure (bar)");
}

float readPressureBar() {
  long sum = 0;

  for (int i = 0; i < 20; i++) {
    sum += analogRead(pressurePin);
    delay(2);
  }

  float raw = sum / 20.0;
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
  float pressureBar = readPressureBar();

  lcd.setCursor(0, 1);
  lcd.print(pressureBar, 1);
  lcd.print("          "); // 이전 측정값의 남은 자릿수 지우기

  Serial.println(pressureBar, 2);
  delay(300);
}
