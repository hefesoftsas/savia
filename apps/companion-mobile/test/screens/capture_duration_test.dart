import 'package:companion_mobile/screens/capture_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('capture duration stays readable through the one-hour limit', () {
    expect(formatCaptureDuration(const Duration(seconds: 9)), '00:00:09');
    expect(
      formatCaptureDuration(const Duration(minutes: 2, seconds: 3)),
      '00:02:03',
    );
    expect(formatCaptureDuration(const Duration(hours: 1)), '01:00:00');
  });
}
