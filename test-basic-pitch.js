const { BasicPitch } = require('@spotify/basic-pitch');

async function test() {
  try {
    console.log('Creating BasicPitch instance...');
    const basicPitch = new BasicPitch();

    console.log('BasicPitch methods:');
    console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(basicPitch)));

    console.log('\nBasicPitch instance type:', typeof basicPitch);
    console.log('Has evaluateModel:', typeof basicPitch.evaluateModel);
    console.log('Has predict:', typeof basicPitch.predict);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();
