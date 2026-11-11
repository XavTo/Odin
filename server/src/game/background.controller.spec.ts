import { BackgroundController } from './background.controller';
import { GameService } from './game.service';

describe('Public background', () => {
  it('returns only the background and handles an unset background', () => {
    const game = { getPhotos: jest.fn().mockReturnValue({
      background: 'data:image/png;base64,YQ==',
      r1: 'data:image/png;base64,Yg==',
    }) } as unknown as GameService;
    const controller = new BackgroundController(game);
    expect(controller.getBackground()).toEqual({ background: 'data:image/png;base64,YQ==' });
    jest.mocked(game.getPhotos).mockReturnValue({ r1: 'data:image/png;base64,Yg==' });
    expect(controller.getBackground()).toEqual({ background: null });
  });
});
