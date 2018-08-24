module.exports = {
  QData1: {
    1: {
      updatedAt: 'dummy_time1',
      resName: 'Dummy User Resource 1'
    },
    2: {
      updatedAt: 'dummy_time1',
      resName: 'Dummy User Resource 2'
    }
  },

  QData2: {
    2: {
      updatedAt: 'dummy_time2',
      resName: 'Dummy User Resource 2'
    },
    3: {
      updatedAt: 'dummy_time1',
      resName: 'Dummy User Resource 3'
    }
  },

  QRData1: {
    qr1: {
      updatedAt: 'dummy_time3',
      resName: 'Dummy Patient Resource qr1'
    },
    qr2: {
      updatedAt: 'dummy_time4',
      resName: 'Dummy Patient Resource qr2'
    }
  },

  QRData2: {
    qr2: {
      updatedAt: 'dummy_time3',
      resName: 'Dummy Patient Resource qr2'
    },
    qr3: {
      updatedAt: 'dummy_time4',
      resName: 'Dummy Patient Resource qr3'
    }
  },

  QData: {
    dummyUserToken1: this.QData1,
    dummyUserToken2: this.QData2
  },

  QRData: {
    dummyPatient1: this.QRData1,
    dummyPatient2: this.QRData2
  }
};