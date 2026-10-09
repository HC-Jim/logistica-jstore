import 'package:flutter_test/flutter_test.dart';
import 'package:logistica_app/utils/formato.dart';

void main() {
  test('decodifica polilínea de Google', () {
    final p = decodificarPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(p.length, 3);
    expect(p.first.latitude, closeTo(38.5, 0.001));
    expect(p.last.longitude, closeTo(-126.453, 0.001));
  });

  test('teléfono peruano para WhatsApp', () {
    expect(telefonoWhatsApp('987 654 321'), '51987654321');
    expect(telefonoWhatsApp(null), isNull);
  });
}
